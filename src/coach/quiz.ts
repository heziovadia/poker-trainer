/** Short multiple-choice questions shown before the hero acts (adaptive frequency). */
import { Rng, shuffle, cardsToPretty } from '../engine/cards';
import { PlayerView } from '../engine/game';
import { evaluate, HandCategory, CATEGORY_NAMES } from '../engine/evaluator';
import { calculateOuts, findDraws, analyzeBoard } from '../engine/boardAnalysis';
import { classOf, preflopPercentile } from '../engine/handClasses';
import { OPEN_RANGE } from '../bots/profiles';
import { Quiz, Topic } from './types';
import { pct, num } from './analyze';

const catLabel = (c: HandCategory) => `${CATEGORY_NAMES[c].he} (${CATEGORY_NAMES[c].en})`;

function options(correct: string, wrong: string[], rng: Rng) {
  const uniq = [...new Set(wrong.filter((w) => w !== correct))].slice(0, 3);
  return shuffle([{ label: correct, correct: true }, ...uniq.map((label) => ({ label, correct: false }))], rng);
}

export function makeQuiz(view: PlayerView, topic: Topic, rng: Rng): Quiz | null {
  const post = view.board.length >= 3;
  switch (topic) {
    case 'handReading': {
      if (!post) return null;
      const v = evaluate([...view.myHole, ...view.board]);
      const near = [v.category - 1, v.category + 1, v.category + 2, v.category - 2]
        .filter((c) => c >= 0 && c <= 8)
        .map((c) => catLabel(c as HandCategory));
      return {
        topic,
        question: 'מה היד הכי טובה שלך כרגע (5 הקלפים הטובים מתוך הקלפים שלך + הלוח)?',
        options: options(catLabel(v.category), near, rng),
        explanation: `5 הקלפים הטובים: ${cardsToPretty(v.best5)} → ${catLabel(v.category)}.`,
      };
    }
    case 'draws': {
      if (!post || view.street === 'river') return null;
      const d = findDraws(view.myHole, view.board).filter((x) => x.kind !== 'backdoorFlush' && x.kind !== 'overcards');
      const names: Record<string, string> = { flushDraw: 'Flush Draw', nutFlushDraw: 'Flush Draw', oesd: 'Open-Ended Straight Draw', gutshot: 'Gutshot', doubleGutshot: 'Open-Ended Straight Draw' };
      const correct = d.length === 0 ? 'אין דרו' : d.length >= 2 ? 'Combo Draw (Flush + Straight)' : names[d[0].kind];
      return {
        topic,
        question: 'איזה Draw יש לך?',
        options: options(correct, ['אין דרו', 'Flush Draw', 'Open-Ended Straight Draw', 'Gutshot', 'Combo Draw (Flush + Straight)'].filter((x) => x !== correct).sort(() => rng() - 0.5), rng),
        explanation: d.length ? d.map((x) => x.he).join(' + ') : 'אין 4 קלפים לצבע ואין 4 קלפים לרצף שמשתמשים בקלפים שלך.',
      };
    }
    case 'outs': {
      if (!post || view.street === 'river') return null;
      const o = calculateOuts(view.myHole, view.board);
      const n = o.outs.length;
      if (n === 0 && rng() < 0.6) return null;
      const wrong = [n + 2, Math.max(0, n - 3), n + 4, n === 0 ? 3 : n * 2].map(String);
      return {
        topic,
        question: 'כמה Outs (קלפים שמשפרים אותך ליד שכנראה מנצחת) יש לך?',
        options: options(String(n), wrong, rng),
        explanation: n
          ? `${n} Outs: ${o.groups.map((g) => `${CATEGORY_NAMES[g.category].en} ${g.cards.length}`).join(', ')}. סיכוי לקלף הבא ≈ ${pct(o.nextCardPct)} (${n} ÷ ${o.unseen}).`
          : 'אין קלפים שמשפרים אותך באופן משמעותי.',
      };
    }
    case 'potOdds': {
      if (view.toCall <= 0) return null;
      const req = view.toCall / (view.pot + view.toCall);
      const c = pct(req);
      const wrong = [pct(view.toCall / Math.max(1, view.pot)), pct(Math.min(0.9, req * 1.6)), pct(Math.max(0.05, req * 0.55))];
      return {
        topic,
        question: `הקופה ${num(view.pot)} ואתה צריך לשלם ${num(view.toCall)}. מה ה-Pot Odds (כמה אחוז אתה צריך לנצח כדי ש-Call ישתלם)?`,
        options: options(c, wrong, rng),
        explanation: `${num(view.toCall)} ÷ (${num(view.pot)} + ${num(view.toCall)}) = ${num(view.toCall)} ÷ ${num(view.pot + view.toCall)} ≈ ${c}. טעות נפוצה: לחלק רק בקופה (${num(view.toCall)} ÷ ${num(view.pot)}) — צריך לכלול גם את ה-Call שלך.`,
      };
    }
    case 'boardTexture': {
      if (!post) return null;
      const t = analyzeBoard(view.board);
      const map = { dry: 'יבש (Dry)', medium: 'בינוני', wet: 'רטוב (Wet)' };
      return {
        topic,
        question: 'איך היית מתאר את הלוח?',
        options: options(map[t.wetness], Object.values(map), rng),
        explanation: t.he,
      };
    }
    case 'position': {
      if (view.street !== 'preflop') return null;
      const cls = classOf(view.myHole);
      const p = preflopPercentile(cls);
      const ow = OPEN_RANGE[view.myPosition] ?? 0.2;
      const raised = view.log.some((l) => l.action === 'raise');
      if (raised || view.myPosition === 'BB') return null;
      const correct = p <= ow ? 'כן — מספיק חזקה למיקום הזה' : 'לא — חלשה מדי למיקום הזה';
      return {
        topic,
        question: `אף אחד לא העלה. האם ${cls} מספיק חזקה כדי לפתוח (Raise) מ-${view.myPosition}?`,
        options: options(correct, ['כן — מספיק חזקה למיקום הזה', 'לא — חלשה מדי למיקום הזה'], rng),
        explanation: `${cls} היא Top ${pct(p)} מהידיים (≈ ${num(p * 1326)} ÷ 1,326 צירופים). טווח פתיחה מקובל מ-${view.myPosition}: בערך Top ${pct(ow)} (≈ ${num(ow * 1326)} ÷ 1,326). ${p <= ow ? `${pct(p)} ≤ ${pct(ow)} → פותחים.` : `${pct(p)} > ${pct(ow)} → מוותרים.`}`,
      };
    }
    default:
      return null;
  }
}
