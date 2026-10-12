/**
 * Decision analysis for the hero. Uses only what the hero can know: own cards, board,
 * public actions and visible opponent styles. Villain hole cards are never read.
 */
import { Rng, cardsToPretty } from '../engine/cards';
import { PlayerView, Position } from '../engine/game';
import { classOf, preflopPercentile, preflopRankIndex, isSuited } from '../engine/handClasses';
import { PREFLOP_EQUITY } from '../engine/preflopTable';
import { equity, relativeStrength, EquityResult } from '../engine/equity';
import { calculateOuts, findDraws, describeMadeHand, analyzeBoard, OutsResult, Draw, MadeHandInfo, BoardTexture } from '../engine/boardAnalysis';
import { CATEGORY_NAMES } from '../engine/evaluator';
import { OPEN_RANGE } from '../bots/profiles';
import { estimateRange, RangeEstimate } from './ranges';
import { AnalysisSection, Alternative, DecisionAnalysis, Grade, HeroDecision, MistakeTag, Topic } from './types';

// ---------------------------------------------------------------- formatting helpers

export const pct = (x: number): string => `${Math.round(x * 100)}%`;
export const num = (x: number): string => Math.round(x).toLocaleString('en-US');

type Key = 'fold' | 'check' | 'call' | 'aggr';

interface Option {
  grade: Grade;
  text: string;
  tags?: MistakeTag[];
}

interface Advice {
  options: Partial<Record<Key, Option>>;
  best: Key;
  bestText: string;
  close: boolean;
  /** Acceptable size for bet/raise as "to" amounts, with explanation. */
  sizing?: { min: number; max: number; text: string };
  extraSections: AnalysisSection[];
  topics: Topic[];
}

interface Ctx {
  view: PlayerView;
  rng: Rng;
  bb: number;
  pot: number;
  toCall: number;
  stack: number;
  opponents: PlayerView['players'];
  inPosition: boolean;
  /** Effective stack (smallest of hero and the biggest live opponent). */
  effStack: number;
}

const keyOf = (d: HeroDecision): Key => (d.type === 'bet' || d.type === 'raise' ? 'aggr' : d.type);

function labelOf(view: PlayerView, k: Key, amount?: number): string {
  const l = view.legal;
  switch (k) {
    case 'fold': return 'Fold (לוותר)';
    case 'check': return 'Check (לבדוק)';
    case 'call': return `Call ${num(view.toCall)} (להשוות)`;
    case 'aggr': {
      const isBet = l ? l.canBet : view.currentBet === 0;
      const word = isBet ? 'Bet (להמר)' : 'Raise (להעלות)';
      return amount ? `${word} ל-${num(amount)}` : word;
    }
  }
}

/** Postflop order: is hero the last to act among players still in the hand? */
function isInPosition(view: PlayerView): boolean {
  const n = view.players.length;
  const order = (i: number) => {
    const off = (i - view.buttonIndex + n) % n;
    return off === 0 ? n : off;
  };
  const mine = order(view.myIndex);
  return view.players.every((p, i) => p.folded || i === view.myIndex || order(i) < mine);
}

function actsAfter(view: PlayerView, otherId: string): boolean {
  const n = view.players.length;
  const order = (i: number) => {
    const off = (i - view.buttonIndex + n) % n;
    return off === 0 ? n : off;
  };
  const oi = view.players.findIndex((p) => p.id === otherId);
  return order(view.myIndex) > order(oi);
}

const POS_HE: Record<Position, string> = {
  BTN: 'Button (הכפתור — המיקום הטוב ביותר)',
  SB: 'Small Blind (מיקום חלש — פועל ראשון אחרי הפלופ)',
  BB: 'Big Blind (שילם כבר בליינד — מקבל מחיר טוב, אבל פועל מוקדם אחרי הפלופ)',
  UTG: 'Under the Gun (המיקום המוקדם ביותר — הרבה שחקנים אחריך)',
  MP: 'Middle Position',
  HJ: 'Hijack (מיקום אמצעי)',
  CO: 'Cutoff (מיקום מאוחר — רק הכפתור והבליינדים אחריך)',
};

// ---------------------------------------------------------------- shared sections

function positionSection(c: Ctx, minLevel: 1 | 2 | 3 = 2): AnalysisSection {
  const { view } = c;
  const lines = [`המיקום שלך: ${view.myPosition} — ${POS_HE[view.myPosition]}.`];
  if (view.street === 'preflop') {
    lines.push('לפני הפלופ: ככל שיש יותר שחקנים שפועלים אחריך, כך צריך יד חזקה יותר כדי להיכנס — יותר שחקנים = יותר סיכוי שלמישהו יש יד טובה.');
  } else {
    lines.push(c.inPosition
      ? 'אתה In Position (IP): אתה פועל אחרון ברחוב הזה. אתה רואה מה היריבים עשו לפני שאתה מחליט — יתרון גדול: אפשר לשלוט בגודל הקופה, לבלף טוב יותר ולהשיג Value.'
      : 'אתה Out of Position (OOP): לפחות יריב אחד פועל אחריך. אתה מחליט בלי לדעת מה הוא יעשה, ולכן כדאי לשחק קצת יותר זהיר עם ידיים בינוניות.');
  }
  return { id: 'position', title: 'מיקום (Position)', lines, minLevel };
}

// ---------------------------------------------------------------- preflop

function preflopAdvice(c: Ctx): Advice {
  const { view, bb } = c;
  const cls = classOf(view.myHole);
  const p = preflopPercentile(cls);
  const pos = view.myPosition;
  const canCheck = !!view.legal?.canCheck;
  const preLog = view.log.filter((l) => l.street === 'preflop');
  const raises = preLog.filter((l) => l.action === 'raise');
  const limpers = preLog.filter((l) => l.action === 'call').length;
  const heroRaised = raises.some((r) => r.playerId === view.myId);
  const options: Partial<Record<Key, Option>> = {};
  const extra: AnalysisSection[] = [];
  let close = false;
  let best: Key = 'fold';
  let bestText = '';
  let sizing: Advice['sizing'];
  const top = (x: number) => `Top ${Math.round(x * 100)}% מהידיים (≈ ${num(x * 1326)} ÷ 1,326 צירופים)`;
  const handTop = `${cls} נמצאת ב-${top(p)}`;

  if (raises.length === 0) {
    if (canCheck) {
      const rw = 0.12;
      sizing = { min: bb * (3 + limpers), max: bb * (4.5 + limpers), text: `העלאה מה-Big Blind מול Limpers: בערך 3-4 BB + 1 BB לכל Limper (${num(bb * (3 + limpers))}–${num(bb * (4.5 + limpers))}).` };
      if (p <= rw) {
        best = 'aggr';
        bestText = `${handTop} — יד חזקה. כשאחרים רק השוו (Limp), כדאי להעלות כדי לבנות קופה עם היתרון שלך ולצמצם את מספר היריבים.`;
        options.aggr = { grade: 'good', text: 'בונה קופה עם יד חזקה ומבודדת יריבים חלשים.' };
        options.check = { grade: 'ok', text: 'לא טעות גדולה — תראה פלופ בחינם — אבל מוותר על Value עם יד חזקה.', tags: ['passive'] };
      } else {
        best = 'check';
        bestText = `${handTop}. אתה ב-Big Blind ואף אחד לא העלה — אפשר לראות פלופ בחינם. אין סיבה לשלם יותר עם יד לא חזקה.`;
        options.check = { grade: 'good', text: 'פלופ בחינם.' };
        options.aggr = p <= 0.25
          ? { grade: 'ok', text: 'העלאה עם יד בינונית אפשרית (כדי לקחת את הקופה עכשיו), אבל תשחק את היד בלי מיקום.' }
          : { grade: 'mistake', text: 'העלאה עם יד חלשה בלי מיקום מכניסה הרבה כסף לקופה בלי יתרון.', tags: ['overaggressive'] };
      }
      options.fold = { grade: 'mistake', text: 'אף פעם לא מוותרים כשאפשר לעשות Check בחינם.', tags: ['freeFold'] };
    } else {
      const ow = (OPEN_RANGE[pos] ?? 0.2) * (limpers ? 0.8 : 1);
      const openTo = bb * (2.5 + limpers);
      sizing = { min: bb * (2 + limpers), max: bb * (4 + limpers * 1.5), text: `גודל פתיחה סטנדרטי: 2.5–3 BB ועוד 1 BB לכל Limper (בערך ${num(openTo)}).` };
      const rangeLine = `טווח פתיחה סביר מ-${pos}: בערך ${top(ow)}${limpers ? ` (קצת יותר צר כי כבר נכנסו ${limpers} שחקנים)` : ''}. ${handTop} (מקום ${preflopRankIndex(cls) + 1} מתוך 169 סוגי ידיים).`;
      if (p <= ow) {
        best = 'aggr';
        bestText = `${rangeLine} לכן היד מספיק טובה כדי להיכנס — ונכנסים ב-Raise, לא ב-Limp: כך אפשר לזכות בקופה מיד או לשחק אותה עם יוזמה.`;
        options.aggr = { grade: 'good', text: 'Raise נותן שתי דרכים לנצח: כולם מוותרים עכשיו, או שיש לך יד טובה יותר אחרי הפלופ.' };
        options.call = { grade: 'ok', text: 'Limp (רק להשוות) פסיבי מדי: אתה לא לוקח יוזמה ומזמין עוד שחקנים לקופה.' };
        options.fold = p <= ow * 0.6
          ? { grade: 'mistake', text: 'זו יד רווחית מהמיקום הזה — ויתור מפסיד הזדמנות.', tags: ['preflopRange'] }
          : { grade: 'ok', text: 'היד קרובה לגבול הטווח, ויתור זהיר מקובל.' };
        close = p > ow * 0.75;
      } else if (p <= ow * 1.35) {
        close = true;
        best = 'fold';
        bestText = `${rangeLine} היד קצת מחוץ לטווח — גבולית. ויתור הוא הבחירה הבטוחה; העלאה אפשרית מול שחקנים הדוקים.`;
        options.fold = { grade: 'good', text: 'בטוח וממושמע.' };
        options.aggr = { grade: 'ok', text: 'מהלך גבולי — עובד יותר כשהשחקנים אחריך הדוקים.' };
        options.call = pos === 'SB' && limpers > 0
          ? { grade: 'ok', text: 'השלמה זולה מה-Small Blind אחרי Limpers מקובלת.' }
          : { grade: 'mistake', text: 'Limp עם יד גבולית: נכנסים לקופה בלי יוזמה ובלי יד חזקה.', tags: ['preflopRange'] };
      } else {
        best = 'fold';
        bestText = `${rangeLine} היד חלשה מדי למיקום הזה — ${pos === 'UTG' || pos === 'HJ' ? 'יש הרבה שחקנים אחריך שיכולים להחזיק יד טובה יותר' : 'גם במיקום מאוחר היא לא רווחית'}.`;
        options.fold = { grade: 'good', text: 'ויתור נכון — חוסך כסף בידיים שמפסידות לאורך זמן.' };
        const tag: MistakeTag = p <= 0.43 ? 'position' : 'preflopRange';
        options.aggr = { grade: 'mistake', text: p <= 0.43 ? 'היד הזו טובה לפתיחה רק ממיקום מאוחר (כמו Button), לא מכאן.' : 'יד חלשה מדי לפתיחה.', tags: [tag] };
        options.call = pos === 'SB' && limpers > 0 && p <= 0.6
          ? { grade: 'ok', text: 'השלמה זולה מה-Small Blind (חצי בליינד) עם Limpers — מקובל.' }
          : { grade: 'mistake', text: 'Limp עם יד חלשה מוביל לידיים קשות אחרי הפלופ.', tags: [tag] };
      }
    }
  } else if (raises.length === 1) {
    const raiser = raises[0];
    const raiserP = view.players.find((x) => x.id === raiser.playerId)!;
    const late = ['CO', 'BTN', 'SB'].includes(raiserP.position);
    const w = late ? 1.3 : 1;
    const ip = actsAfter(view, raiser.playerId) && pos !== 'SB' && pos !== 'BB';
    const tb = 0.06 * w;
    const callers = preLog.filter((l) => l.action === 'call' && preLog.indexOf(l) > preLog.indexOf(raiser)).length;
    const callTop = (pos === 'BB' ? 0.3 : ip ? 0.16 : 0.11) * w * (callers ? 1.1 : 1);
    const potOdds = c.toCall / (c.pot + c.toCall);
    const to3 = view.currentBet * (ip ? 3 : 3.8) + view.currentBet * callers;
    sizing = { min: view.currentBet * 2.5, max: view.currentBet * (4.6 + callers), text: `3-Bet סטנדרטי: בערך פי 3 מההעלאה כשאתה In Position, פי 3.5–4 כשאתה Out of Position, ועוד ×1 לכל שחקן ששילם (בערך ${num(to3)}).` };
    const ctxLine = `${raiserP.name} העלה מ-${raiserP.position}${late ? ' (מיקום מאוחר — הטווח שלו רחב יותר)' : ' (מיקום מוקדם — הטווח שלו חזק)'}. ${handTop}. ${pos === 'BB' ? `אתה ב-Big Blind ומקבל מחיר: צריך לשלם ${num(c.toCall)} לקופה של ${num(c.pot + c.toCall)} → ${num(c.toCall)} ÷ ${num(c.pot + c.toCall)} = ${pct(potOdds)}.` : ip ? 'תשחק אחריו אחרי הפלופ (In Position) — זה מאפשר לשלם עם יותר ידיים.' : 'תשחק לפניו אחרי הפלופ (Out of Position) — צריך יד חזקה יותר כדי לשלם.'}`;
    const wheelAce = cls[0] === 'A' && isSuited(cls) && '2345'.includes(cls[1]);
    if (p <= tb) {
      best = 'aggr';
      bestText = `${ctxLine} היד שלך חזקה מספיק ל-3-Bet בשביל Value: אתה רוצה להכניס כסף כשאתה כנראה מוביל.`;
      options.aggr = { grade: 'good', text: '3-Bet בונה קופה עם יד חזקה ומקשה על היריב.' };
      options.call = { grade: 'ok', text: 'Call מסתיר את חוזק היד, אבל נותן לעוד שחקנים להיכנס בזול.' };
      options.fold = { grade: 'mistake', text: 'ויתור על יד מהטופ מול העלאה אחת הוא טעות יקרה.', tags: ['preflopRange'] };
    } else if (p <= callTop) {
      best = 'call';
      close = p > callTop * 0.8;
      bestText = `${ctxLine} היד טובה מספיק כדי להמשיך, אבל לא מספיק כדי להעלות — Call הוא האיזון.`;
      options.call = { grade: 'good', text: 'ממשיך עם יד שמשחקת טוב אחרי הפלופ.' };
      options.aggr = p <= tb * 1.8 || (wheelAce && ip)
        ? { grade: 'ok', text: '3-Bet אפשרי (לפעמים כחצי בלוף), אבל Call פשוט יותר.' }
        : { grade: 'mistake', text: '3-Bet עם יד בינונית: כשהוא ממשיך, לרוב יש לו יד טובה יותר.', tags: ['overaggressive'] };
      options.fold = p > callTop * 0.75
        ? { grade: 'ok', text: 'יד גבולית — ויתור זהיר מקובל.' }
        : { grade: 'mistake', text: pos === 'BB' ? 'ב-Big Blind אתה מקבל מחיר טוב — היד הזו שווה Call.' : 'יד טובה מספיק כדי להמשיך.', tags: [pos === 'BB' ? 'potOdds' : 'preflopRange'] };
    } else {
      best = 'fold';
      bestText = `${ctxLine} מול העלאה, היד הזו חלשה מדי${!late ? ' — ולעיתים קרובות נשלטת (Dominated) ע"י הידיים שהוא מעלה איתן' : ''}.`;
      options.fold = { grade: 'good', text: 'ויתור ממושמע.' };
      options.call = pos === 'BB' && p <= 0.45 && c.toCall <= bb * 2.5
        ? { grade: 'ok', text: 'מה-Big Blind המחיר זול מספיק כדי להגן לפעמים עם יד כזו.' }
        : { grade: 'mistake', text: `Call עם יד שמפסידה לרוב הטווח של המעלה.${pos === 'BB' ? ` גם עם המחיר (${pct(potOdds)} = ${num(c.toCall)} ÷ ${num(c.pot + c.toCall)}) זה יקר מדי.` : ''}`, tags: [pos === 'BB' ? 'potOdds' : p <= 0.3 ? 'position' : 'preflopRange'] };
      options.aggr = wheelAce
        ? { grade: 'ok', text: 'A5s–A2s הן ידיים קלאסיות ל-3-Bet בלוף: יש להן Blocker לאס ופוטנציאל ל-Flush/Straight.' }
        : { grade: 'mistake', text: 'בלוף 3-Bet עם יד בלי פוטנציאל — מהלך יקר.', tags: ['overaggressive'] };
    }
    // Domination note for weak-kicker big cards.
    if (/^[AKQ][2-9TJ]o$/.test(cls) && !late) {
      extra.push({ id: 'domination', title: 'Domination (יד נשלטת)', minLevel: 3, lines: [
        `${cls} היא יד שנוטה להיות Dominated: אם היריב מחזיק ${cls[0]} עם קיקר טוב יותר (למשל ${cls[0]}K או ${cls[0]}Q), גם כשתפגע בזוג תפסיד הרבה כסף.`,
        'מול העלאה ממיקום מוקדם הטווח מלא בידיים כאלה — לכן ידיים כמו AJo/KQo חלשות כאן ממה שהן נראות.',
      ] });
    }
  } else {
    const fb = 0.028;
    const callTop = heroRaised ? 0.07 : 0.045;
    sizing = { min: view.currentBet * 2.1, max: c.stack + (view.players[view.myIndex].streetBet), text: '4-Bet: בערך פי 2.2–2.5 מה-3-Bet, או All-in כשהסטאקים קצרים.' };
    const ctxLine = `היו כבר ${raises.length} העלאות לפני הפלופ — טווחים של 3-Bet ומעלה צרים וחזקים מאוד. ${handTop}.`;
    if (p <= fb) {
      best = 'aggr';
      bestText = `${ctxLine} עם יד מהטופ הכי עליון (כמו QQ+/AK) מעלים שוב — אתה מוביל גם מול טווח חזק.`;
      options.aggr = { grade: 'good', text: 'מכניס כסף כשאתה בראש הטווח.' };
      options.call = { grade: 'ok', text: 'Call סביר, אבל נותן ליריב לראות פלופ בזול.' };
      options.fold = { grade: 'mistake', text: 'ויתור על אחת הידיים הטובות ביותר.', tags: ['preflopRange'] };
    } else if (p <= callTop) {
      best = 'call';
      close = true;
      bestText = `${ctxLine} יד חזקה אבל לא בראש הטווח — Call כדי לראות פלופ.`;
      options.call = { grade: 'good', text: 'ממשיך בלי לנפח את הקופה.' };
      options.aggr = { grade: 'ok', text: 'העלאה נוספת מסכנת הרבה כסף מול טווח חזק.' };
      options.fold = { grade: 'ok', text: 'ויתור זהיר מקובל מול טווח צר.' };
    } else {
      best = 'fold';
      bestText = `${ctxLine} רוב הידיים שעושות 3-Bet/4-Bet מובילות עליך בבירור.`;
      options.fold = { grade: 'good', text: 'ויתור נכון מול אקשן כבד.' };
      options.call = { grade: 'mistake', text: 'Call יקר עם יד שמפסידה לרוב הטווח.', tags: ['potOdds'] };
      options.aggr = { grade: 'mistake', text: 'העלאה כאן היא בלוף יקר מאוד.', tags: ['overaggressive'] };
    }
  }

  if (!view.legal?.canCheck) delete options.check;
  if (view.legal?.canCheck) delete options.call;
  if (!view.legal?.canBet && !view.legal?.canRaise) delete options.aggr;
  if (!options[best]) best = (Object.keys(options) as Key[]).find((k) => options[k]!.grade === 'good') ?? (view.legal?.canCheck ? 'check' : 'fold');
  return { options, best, bestText, close, sizing, extraSections: extra, topics: ['preflop', 'position'] };
}

// ---------------------------------------------------------------- postflop

interface PostflopData {
  made: MadeHandInfo;
  draws: Draw[];
  outs: OutsResult | null;
  texture: BoardTexture;
  ranges: RangeEstimate[];
  eq: EquityResult;
}

function postflopData(c: Ctx): PostflopData {
  const { view } = c;
  const made = describeMadeHand(view.myHole, view.board);
  const draws = view.street === 'river' ? [] : findDraws(view.myHole, view.board);
  const outs = view.street === 'river' ? null : calculateOuts(view.myHole, view.board);
  const texture = analyzeBoard(view.board);
  const ranges = c.opponents.map((o) => estimateRange(view, o.id));
  const eq = equity({ hero: view.myHole, board: view.board, opponents: ranges.map((r) => r.combos), iterations: 1500, rng: c.rng });
  return { made, draws, outs, texture, ranges, eq };
}

function postflopAdvice(c: Ctx, d: PostflopData): Advice {
  const { view } = c;
  const e = d.eq.equity;
  const opp = c.opponents.length;
  const options: Partial<Record<Key, Option>> = {};
  let best: Key;
  let bestText: string;
  let close = false;
  const outsN = d.outs?.outs.length ?? 0;
  const strongDraw = outsN >= 8 && view.street !== 'river';
  const wet = d.texture.wetness === 'wet';
  const eqStr = `${pct(e)} (${num(d.eq.wins)} + ½×${num(d.eq.ties)} ÷ ${num(d.eq.iterations)} סימולציות)`;
  const eqLine = `ה-Equity שלך מול הטווח המשוער ${opp > 1 ? `של ${opp} היריבים ` : ''}≈ ${eqStr}`;
  const isAggressor = view.preflopAggressorId === view.myId;
  let sizing: Advice['sizing'];
  const potNow = c.pot;

  if (c.toCall > 0) {
    const req = c.toCall / (c.pot + c.toCall);
    const implied = strongDraw && view.street !== 'river' && c.effStack > c.pot * 1.5 && !view.legal?.callIsAllIn ? Math.min(0.07, 0.02 + outsN * 0.004) : 0;
    const eff = e + implied;
    const reqStr = `${pct(req)} (${num(c.toCall)} ÷ ${num(c.pot + c.toCall)})`;
    const reqLine = `צריך לנצח לפחות ${reqStr}`;
    const raiseMin = view.currentBet * 2.5;
    sizing = { min: view.currentBet * 2.2, max: view.currentBet * 4 + c.pot, text: `Raise סטנדרטי: בערך פי 2.5–3 מההימור של היריב (כאן ≈ ${num(raiseMin)}–${num(view.currentBet * 3)}).` };
    if (e >= 0.66 && (d.made.tier === 'strong' || d.made.tier === 'monster')) {
      best = 'aggr';
      bestText = `${eqLine}, ו${reqLine}. היד שלך חזקה ומובילה על רוב הטווח — Raise בשביל Value: ידיים חלשות יותר ימשיכו לשלם.`;
      options.aggr = { grade: 'good', text: 'מכניס יותר כסף כשאתה מוביל.' };
      options.call = { grade: 'ok', text: wet ? 'Call מסוכן קצת בלוח רטוב — אתה נותן לדרואים קלף זול.' : 'Call (Slowplay) סביר בלוח יבש, אבל מפסיד Value.', tags: wet ? ['passive'] : undefined };
      options.fold = { grade: 'mistake', text: 'ויתור עם יד חזקה מאוד.', tags: ['potOdds'] };
    } else if (eff >= req + 0.03) {
      best = 'call';
      bestText = `${eqLine}, ו${reqLine}. ${pct(e)} > ${pct(req)} → Call רווחי לאורך זמן.${implied ? ` בנוסף יש Implied Odds: אם תשלים את הדרו אפשר לזכות ביותר כסף ברחובות הבאים.` : ''}`;
      options.call = { grade: 'good', text: 'המחיר מוצדק לפי הסיכויים.' };
      options.aggr = strongDraw && opp === 1
        ? { grade: 'ok', text: `Semi-Bluff Raise עם ${outsN} Outs: אפשר לזכות עכשיו, ואם משלמים — עדיין יש סיכוי טוב להשתפר.` }
        : e >= 0.55
          ? { grade: 'ok', text: 'Raise לערך אפשרי — אבל כשהיריב ממשיך, הוא לרוב חזק.' }
          : { grade: 'mistake', text: 'Raise עם יד בינונית: ידיים חלשות יוותרו וחזקות ימשיכו — אתה מבודד את עצמך מול ידיים טובות יותר.', tags: ['overaggressive'] };
      options.fold = { grade: 'mistake', text: `ויתור כשה-Equity ${eqStr} גבוה מה-Pot Odds ${reqStr} — מוותר על החלטה רווחית.`, tags: ['potOdds'] };
    } else if (eff >= req - 0.04) {
      close = true;
      best = eff >= req ? 'call' : 'fold';
      bestText = `${eqLine}, ו${reqLine}. המספרים קרובים מאוד — זו החלטה גבולית. ${best === 'call' ? 'Call מעט עדיף' : 'Fold מעט עדיף'}, אבל שתי האפשרויות סבירות.`;
      options.call = { grade: best === 'call' ? 'good' : 'ok', text: 'קרוב לנקודת האיזון.' };
      options.fold = { grade: best === 'fold' ? 'good' : 'ok', text: 'קרוב לנקודת האיזון.' };
      options.aggr = strongDraw && opp === 1
        ? { grade: 'ok', text: 'Semi-Bluff Raise יכול להפוך החלטה גבולית לרווחית — מגיע עם סיכון.' }
        : { grade: 'mistake', text: 'Raise בהחלטה גבולית בלי דרו חזק מסכן הרבה בלי יתרון.', tags: ['overaggressive'] };
    } else {
      best = 'fold';
      bestText = `${eqLine}, אבל ${reqLine}. ${pct(e)} < ${pct(req)} → Call מפסיד כסף לאורך זמן.${d.made.tier === 'medium' ? ' גם אם יש לך זוג — מול ההימור הזה הטווח של היריב חזק יותר.' : ''}`;
      options.fold = { grade: 'good', text: 'שומר על הצ\'יפים כשהמחיר יקר מדי.' };
      options.call = { grade: 'mistake', text: `Call כשה-Equity ${eqStr} נמוך מה-Pot Odds ${reqStr}.`, tags: ['potOdds'] };
      options.aggr = { grade: 'mistake', text: 'בלוף-רייז הוא מהלך מתקדם ומסוכן — במיוחד מול כמה שחקנים או יריב שמשלם הרבה.', tags: ['overaggressive'] };
    }
  } else {
    const valueTh = 0.6 + 0.04 * (opp - 1);
    const sizeMin = wet ? 0.5 : 0.33;
    const sizeMax = wet ? 0.85 : 0.7;
    sizing = { min: potNow * (sizeMin - 0.08), max: potNow * 1.1, text: `גודל מומלץ: ${wet ? 'בלוח רטוב 1/2–3/4 קופה (כדי שדרואים ישלמו מחיר)' : 'בלוח יבש 1/3–2/3 קופה'} → בערך ${num(potNow * sizeMin)}–${num(potNow * sizeMax)} (קופה ${num(potNow)}).` };
    if (e >= valueTh) {
      best = 'aggr';
      bestText = `${eqLine}. אתה מוביל על רוב הטווח — Value Bet: ידיים חלשות יותר (זוגות נמוכים, דרואים) ישלמו לך.`;
      options.aggr = { grade: 'good', text: 'Value Bet — מרוויח מידיים חלשות יותר.' };
      options.check = e >= 0.75 && !wet
        ? { grade: 'ok', text: 'Check (Slowplay) בלוח יבש אפשרי כדי לתת ליריב לבלף, אבל בדרך כלל מפסיד Value.', tags: ['passive'] }
        : { grade: e >= 0.7 ? 'mistake' : 'ok', text: 'Check מוותר על Value ונותן קלף חינם לדרואים.', tags: ['passive'] };
    } else if (strongDraw) {
      close = true;
      const betBest = c.inPosition || isAggressor || opp === 1;
      best = betBest ? 'aggr' : 'check';
      bestText = `${eqLine}, עם ${outsN} Outs. עם דרו חזק יש שתי דרכים טובות: Semi-Bluff (להמר עכשיו — אפשר לזכות מיד או להשלים) או Check לקלף חינם. ${betBest ? 'כאן Semi-Bluff עדיף מעט כי ' + (c.inPosition ? 'אתה In Position' : isAggressor ? 'אתה המעלה מלפני הפלופ' : 'יש רק יריב אחד') + '.' : 'כאן Check עדיף מעט כי אתה Out of Position מול כמה יריבים.'}`;
      options.aggr = { grade: betBest ? 'good' : 'ok', text: 'Semi-Bluff: לוחץ על היריב ושומר על סיכוי להשתפר.' };
      options.check = { grade: betBest ? 'ok' : 'good', text: 'Check לוקח קלף חינם בלי סיכון.' };
    } else if (e >= 0.42) {
      best = 'check';
      bestText = `${eqLine}. יד בינונית: חזקה מספיק כדי להגיע ל-Showdown, אבל לא מספיק כדי לקבל Call מידיים חלשות יותר. Check שולט בגודל הקופה (Pot Control).`;
      options.check = { grade: 'good', text: 'Pot Control — שומר על קופה קטנה עם יד בינונית.' };
      options.aggr = opp === 1 && (c.inPosition || isAggressor)
        ? { grade: 'ok', text: 'הימור קטן (Thin Value / הגנה) אפשרי מול יריב אחד.' }
        : { grade: 'ok', text: 'הימור עם יד בינונית מול כמה יריבים: לרוב רק ידיים טובות יותר ימשיכו.' };
    } else {
      const bluffSpot = opp === 1 && (isAggressor && view.street === 'flop' ? true : c.inPosition) && !wet;
      best = 'check';
      bestText = `${eqLine}. היד חלשה — בדרך כלל Check. ${bluffSpot ? 'עם זאת, מול יריב אחד בלוח יבש' + (isAggressor ? ' כשאתה היית המעלה (C-Bet)' : '') + ' בלוף קטן הוא מהלך סביר.' : 'בלוף כאן לא מומלץ: ' + (opp > 1 ? 'יש כמה יריבים, ומספיק שאחד מהם ימשיך.' : wet ? 'הלוח רטוב ויש ליריב הרבה דרואים להמשיך איתם.' : 'אין לך יתרון מיקום או יוזמה.')}`;
      options.check = { grade: 'good', text: 'לא מכניס כסף עם יד חלשה.' };
      options.aggr = bluffSpot
        ? { grade: 'ok', text: 'בלוף/C-Bet קטן: מול יריב אחד בלוח יבש הוא יוותר לעיתים קרובות.' }
        : { grade: 'mistake', text: 'בלוף בתנאים לא טובים (כמה יריבים / לוח רטוב / בלי מיקום).', tags: ['overaggressive'] };
    }
    options.fold = { grade: 'mistake', text: 'אף פעם לא מוותרים כשאפשר לעשות Check בחינם.', tags: ['freeFold'] };
  }
  if (!view.legal?.canCheck) delete options.check;
  if (view.legal?.canCheck) delete options.call;
  if (!view.legal?.canBet && !view.legal?.canRaise) delete options.aggr;
  if (!options[best]) best = (Object.keys(options) as Key[]).find((k) => options[k]!.grade === 'good') ?? (view.legal?.canCheck ? 'check' : 'fold');
  return { options, best, bestText, close, sizing, extraSections: [], topics: ['handReading', 'potOdds'] };
}

function postflopSections(c: Ctx, d: PostflopData): AnalysisSection[] {
  const { view } = c;
  const sections: AnalysisSection[] = [];
  const rs = relativeStrength(view.myHole, view.board);

  sections.push({
    id: 'hand', title: 'היד שלך', minLevel: 1, lines: [
      d.made.he,
      `5 הקלפים הטובים ביותר: ${cardsToPretty(d.made.value.best5)}.`,
      `חוזק יחסי: מול כל יד אפשרית של יריב אחד אתה מוביל ב-${pct(rs.pct)} מהמקרים (${num(rs.beats)} ניצחונות + חצי מ-${num(rs.ties)} תיקו ÷ ${num(rs.total)} ידיים אפשריות).`,
      rs.losesTo <= 3 ? 'זו כמעט היד הטובה ביותר האפשרית כרגע (The Nuts).' : `${num(rs.losesTo)} צירופים אפשריים מובילים עליך כרגע.`,
    ],
  });
  sections.push({ id: 'board', title: 'קריאת הלוח (Board Texture)', minLevel: 1, lines: [d.texture.he] });

  if (view.street !== 'river') {
    const drawLines = d.draws.length
      ? d.draws.map((dr) => `• ${dr.he}${dr.outs ? ` — בערך ${dr.outs} Outs` : ''}`)
      : ['אין לך דרו משמעותי (לא Flush Draw ולא Straight Draw).'];
    sections.push({ id: 'draws', title: 'דרואים (Draws)', minLevel: 1, lines: drawLines });
    if (d.outs) {
      const o = d.outs;
      const n = o.outs.length;
      const lines: string[] = [];
      if (n === 0) lines.push('אין קלפים שמשפרים אותך לקטגוריה טובה יותר באופן משמעותי.');
      else {
        lines.push(`יש לך ${n} Outs (קלפים שמשפרים אותך):`);
        for (const g of o.groups) lines.push(`• ${CATEGORY_NAMES[g.category].he} (${CATEGORY_NAMES[g.category].en}): ${g.cards.length} קלפים — ${cardsToPretty(g.cards)}`);
        lines.push(`סיכוי לפגוע בקלף הבא ≈ ${pct(o.nextCardPct)} (${n} Outs ÷ ${o.unseen} קלפים לא ידועים).`);
        if (view.street === 'flop') {
          lines.push(`סיכוי לפגוע עד הריבר (2 קלפים) ≈ ${pct(o.byRiverPct)} (1 − (${o.unseen - n}/${o.unseen} × ${o.unseen - 1 - n}/${o.unseen - 1})).`);
          lines.push(`כלל אצבע — "כלל ה-4": ${n} × 4 ≈ ${Math.min(100, n * 4)}% עד הריבר; "כלל ה-2": ${n} × 2 ≈ ${n * 2}% לקלף אחד.`);
        } else {
          lines.push(`כלל אצבע — "כלל ה-2": ${n} × 2 ≈ ${n * 2}% לקלף הבא.`);
        }
        lines.push('שימו לב: Outs לא מבטיחים ניצחון — לפעמים גם היריב משתפר (Outs "מלוכלכים").');
      }
      sections.push({ id: 'outs', title: 'Outs וסיכויים', minLevel: 2, lines });
    }
  }

  if (c.toCall > 0) {
    const req = c.toCall / (c.pot + c.toCall);
    const lines = [
      `הקופה עכשיו ${num(c.pot)} וצריך לשלם ${num(c.toCall)}. אחרי ה-Call הקופה תהיה ${num(c.pot + c.toCall)}.`,
      `Pot Odds ≈ ${pct(req)} (${num(c.toCall)} ÷ ${num(c.pot + c.toCall)}) — כלומר Call רווחי אם אתה מנצח יותר מ-${pct(req)} מהפעמים.`,
    ];
    if (d.outs && d.outs.outs.length && view.street !== 'river') {
      lines.push(`השוואה ל-Outs: סיכוי להשלים בקלף הבא ${pct(d.outs.nextCardPct)} (${d.outs.outs.length} ÷ ${d.outs.unseen}) ${d.outs.nextCardPct >= req ? '≥' : '<'} ${pct(req)} הנדרשים.`);
    }
    sections.push({ id: 'potOdds', title: 'Pot Odds', minLevel: 2, lines });
  } else {
    sections.push({ id: 'potOdds', title: 'Pot Odds', minLevel: 2, lines: ['אין הימור מולך, אז אין Pot Odds לחשב. השאלה כאן היא האם להמר (בשביל Value או כבלוף) או לבדוק.'] });
  }

  sections.push(positionSection(c));

  const rangeLines: string[] = [];
  for (const r of d.ranges) {
    rangeLines.push(`▸ ${r.name}:`);
    rangeLines.push(...r.explanation.map((x) => `   ${x}`));
    if (r.preflopText) rangeLines.push(`   טווח לפני הפלופ (בערך): ${r.preflopText}`);
    const b = r.buckets;
    const w = r.bucketWeights;
    const tw = r.totalWeight || 1;
    rangeLines.push(`   על הלוח הזה הטווח שלו (משקל צירופים ÷ סה"כ ${num(tw)}): חזקות ${pct(b.strong)} (${num(w.strong)} ÷ ${num(tw)}) · בינוניות ${pct(b.medium)} (${num(w.medium)} ÷ ${num(tw)}) · דרואים ${pct(b.draw)} (${num(w.draw)} ÷ ${num(tw)}) · אוויר ${pct(b.air)} (${num(w.air)} ÷ ${num(tw)}).`);
  }
  sections.push({ id: 'ranges', title: 'Range משוער של היריבים', minLevel: 3, lines: rangeLines });

  const tiesHalf = d.eq.ties / 2;
  sections.push({ id: 'equity', title: 'Equity מול הטווח', minLevel: 3, lines: [
    `Equity ≈ ${pct(d.eq.equity)} (${num(d.eq.wins)} ניצחונות + בערך ${num(tiesHalf)} מתיקו ÷ ${num(d.eq.iterations)} סימולציות מול הטווח המשוער).`,
    'Equity = החלק מהקופה ש"שייך" לך בממוצע אם כל הקלפים ייפתחו עד הסוף.',
  ] });
  return sections;
}

// ---------------------------------------------------------------- main

function betKindOf(decision: HeroDecision, e: number, made: MadeHandInfo | null, outsN: number): DecisionAnalysis['betKind'] {
  if (decision.type !== 'bet' && decision.type !== 'raise') return undefined;
  if (made && (made.tier === 'strong' || made.tier === 'monster')) return 'value';
  if (e >= 0.55) return 'value';
  if (outsN >= 8) return 'semiBluff';
  return 'bluff';
}

const GRADE_TEXT: Record<Grade, string> = {
  good: 'החלטה טובה ✅',
  ok: 'החלטה סבירה 🟡',
  mistake: 'החלטה שגויה ❌',
};

let counter = 0;

export function analyzeDecision(view: PlayerView, decision: HeroDecision, rng: Rng): DecisionAnalysis {
  if (!view.legal) throw new Error('Hero is not to act');
  const me = view.players[view.myIndex];
  const opponents = view.players.filter((p) => !p.folded && p.id !== view.myId);
  const effStack = Math.min(me.stack, Math.max(...opponents.map((o) => o.stack), 0));
  const c: Ctx = {
    view, rng, bb: view.config.bigBlind, pot: view.pot, toCall: view.toCall, stack: me.stack,
    opponents, inPosition: isInPosition(view), effStack,
  };

  let advice: Advice;
  let sections: AnalysisSection[] = [];
  let e = 0;
  let made: MadeHandInfo | null = null;
  let outsN = 0;
  if (view.street === 'preflop') {
    advice = preflopAdvice(c);
    const cls = classOf(view.myHole);
    const pe = PREFLOP_EQUITY[cls];
    e = pe?.hu ?? 0.5;
    const p = preflopPercentile(cls);
    sections.push({ id: 'hand', title: 'היד שלך', minLevel: 1, lines: [
      `${cardsToPretty(view.myHole)} = ${cls} (${cls.length === 2 ? 'Pocket Pair — זוג ביד' : isSuited(cls) ? 'Suited — אותו סוג' : 'Offsuit — סוגים שונים'}).`,
      `דירוג: מקום ${preflopRankIndex(cls) + 1} מתוך 169 סוגי ידיים פתיחה → Top ${pct(p)} (כל הצירופים הטובים ממנה או שווים לה ÷ 1,326 צירופים אפשריים).`,
      pe ? `Equity לפני הפלופ: מול יד אקראית אחת ≈ ${pct(pe.hu)}, מול 3 ידיים אקראיות ≈ ${pct(pe.mw)} (ניצחונות ÷ 30,000 סימולציות לכל סוג יד).` : '',
    ].filter(Boolean) });
    sections.push(positionSection(c, 1));
    if (c.toCall > 0) {
      const req = c.toCall / (c.pot + c.toCall);
      sections.push({ id: 'potOdds', title: 'Pot Odds', minLevel: 2, lines: [
        `צריך לשלם ${num(c.toCall)} לקופה שתהיה ${num(c.pot + c.toCall)} → Pot Odds ≈ ${pct(req)} (${num(c.toCall)} ÷ ${num(c.pot + c.toCall)}).`,
        'לפני הפלופ ה-Pot Odds הם רק חלק מהתמונה: חשוב גם המיקום, ואיך היד תשחק אחרי הפלופ.',
      ] });
    }
    const rangeLines: string[] = [];
    for (const o of opponents) {
      const acted = view.log.some((l) => l.street === 'preflop' && l.playerId === o.id && (l.action === 'raise' || l.action === 'call'));
      if (!acted) continue;
      const r = estimateRange(view, o.id);
      rangeLines.push(...r.explanation, `טווח משוער: ${r.preflopText || '—'}`);
    }
    if (rangeLines.length) sections.push({ id: 'ranges', title: 'Range משוער של היריבים', minLevel: 3, lines: rangeLines });
  } else {
    const d = postflopData(c);
    advice = postflopAdvice(c, d);
    sections = postflopSections(c, d);
    e = d.eq.equity;
    made = d.made;
    outsN = d.outs?.outs.length ?? 0;
  }

  const k = keyOf(decision);
  const chosen = advice.options[k] ?? { grade: 'mistake' as Grade, text: 'פעולה לא צפויה במצב הזה.' };
  let grade = chosen.grade;
  const mistakes = new Set<MistakeTag>(grade === 'good' ? [] : chosen.tags ?? []);
  if (grade === 'mistake' && !chosen.tags?.length) mistakes.add(view.street === 'preflop' ? 'preflopRange' : 'potOdds');

  // Bet sizing check
  const sizingLines: string[] = [];
  if (advice.sizing) sizingLines.push(advice.sizing.text);
  if (k === 'aggr' && decision.amount && advice.sizing) {
    const amt = decision.amount;
    const allIn = view.legal.maxTo === amt;
    const { min, max } = advice.sizing;
    const potBefore = view.pot + (view.currentBet ? view.toCall : 0);
    const frac = view.currentBet === 0 ? amt / Math.max(1, view.pot) : (amt - view.currentBet) / Math.max(1, potBefore);
    sizingLines.push(`הסכום שבחרת: ${num(amt)}${view.currentBet === 0 ? ` = ${pct(frac)} מהקופה (${num(amt)} ÷ ${num(view.pot)})` : ''}${allIn ? ' (All-in)' : ''}.`);
    const deepAllIn = allIn && amt > view.pot * 3 && amt > c.bb * 25;
    if ((amt < min || amt > max) && !(allIn && amt <= max * 1.3)) {
      mistakes.add('betSizing');
      const tooBig = amt > max;
      sizingLines.push(tooBig
        ? 'הסכום גדול מהמומלץ: ידיים חלשות יוותרו וישלמו לך רק ידיים חזקות — אתה מסכן הרבה כדי לזכות במעט.'
        : 'הסכום קטן מהמומלץ: אתה נותן ליריבים מחיר זול להמשיך ולהשלים דרואים, ומרוויח פחות עם ידיים חזקות.');
      if (grade === 'good') grade = 'ok';
      else if (grade === 'ok' && (deepAllIn || amt < min * 0.6)) grade = 'mistake';
    } else {
      sizingLines.push('הגודל בטווח הסביר 👍');
    }
  }
  if (sizingLines.length) sections.push({ id: 'sizing', title: 'גודל הימור (Bet Sizing)', minLevel: 2, lines: sizingLines });

  const betKind = betKindOf(decision, e, made, outsN);
  if (betKind) {
    const t = {
      value: 'Value Bet: הימרת עם יד שכנראה מובילה — המטרה שידיים חלשות יותר ישלמו.',
      semiBluff: 'Semi-Bluff: הימרת עם דרו — אפשר לזכות עכשיו אם היריב מוותר, ואם לא, עדיין יש לך Outs.',
      bluff: 'Bluff: הימרת עם יד חלשה — המטרה שהיריב יוותר על יד טובה יותר. מצליח בעיקר מול יריב אחד, בלוח מפחיד, כשהסיפור שלך הגיוני.',
    }[betKind];
    sections.push({ id: 'betKind', title: 'סוג ההימור שלך', minLevel: 3, lines: [t] });
  }
  sections.push(...advice.extraSections);

  const alternatives: Alternative[] = (Object.keys(advice.options) as Key[])
    .filter((x) => x !== k)
    .map((x) => ({ label: labelOf(view, x), verdict: advice.options[x]!.grade, text: advice.options[x]!.text }));

  const topics = new Set<Topic>(advice.topics);
  if (view.street !== 'preflop') {
    topics.add('boardTexture');
    if (outsN) { topics.add('outs'); topics.add('draws'); }
    if (opponents.length) topics.add('ranges');
  }
  if (k === 'aggr') { topics.add('betSizing'); topics.add('valueBluff'); }
  if (mistakes.has('position')) topics.add('position');

  return {
    id: `${view.handNumber}-${view.street}-${++counter}-${Date.now()}`,
    handNumber: view.handNumber,
    street: view.street,
    actionLabel: labelOf(view, k, decision.amount),
    grade,
    verdictText: `${GRADE_TEXT[grade]} — ${chosen.text}`,
    recommendedLabel: labelOf(view, advice.best),
    recommendedText: advice.bestText,
    alternatives,
    sections: sections.filter((s) => s.lines.length),
    mistakes: [...mistakes],
    topics: [...topics],
    betKind,
    close: advice.close,
  };
}
