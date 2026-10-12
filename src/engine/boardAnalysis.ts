/**
 * Board reading: made-hand description, draws, outs and board texture.
 * Everything here uses only hero's cards and the board.
 */
import { Card, fullDeck, rankOf, suitOf, rankLabel, cardToPretty, SUIT_SYMBOLS } from './cards';
import { evaluate, HandCategory, HandValue, CATEGORY_NAMES, handNameEn } from './evaluator';

// ---------------------------------------------------------------- outs

export interface Out {
  card: Card;
  makes: HandCategory;
}

export interface OutsResult {
  current: HandValue;
  outs: Out[];
  /** Unknown cards from hero's point of view (52 − hole − board). */
  unseen: number;
  /** Chance to hit on the next card: outs / unseen. */
  nextCardPct: number;
  /** Chance to hit by the river (flop only; equals nextCardPct on the turn). */
  byRiverPct: number;
  /** Groups for display: category → cards. */
  groups: { category: HandCategory; cards: Card[] }[];
}

/** Category of a 3-5 card board on its own (pairs only below 5 cards). */
function boardOnlyCategory(board: Card[]): HandCategory {
  if (board.length === 5) return evaluate(board).category;
  const counts = new Map<number, number>();
  for (const c of board) counts.set(rankOf(c), (counts.get(rankOf(c)) ?? 0) + 1);
  const v = [...counts.values()].sort((a, b) => b - a);
  if (v[0] === 4) return HandCategory.Quads;
  if (v[0] === 3) return HandCategory.Trips;
  if (v[0] === 2 && v[1] === 2) return HandCategory.TwoPair;
  if (v[0] === 2) return HandCategory.OnePair;
  return HandCategory.HighCard;
}

/**
 * A card is an out when it moves hero to a better hand category that actually uses hero's
 * hole cards. Weak improvements are excluded the way players count outs in practice:
 * pairing an undercard, or the board pairing itself, are not outs.
 */
export function calculateOuts(hole: Card[], board: Card[]): OutsResult {
  if (board.length < 3 || board.length > 4) throw new Error('Outs are counted on the flop or turn');
  const known = new Set([...hole, ...board]);
  const unseenCards = fullDeck().filter((c) => !known.has(c));
  const current = evaluate([...hole, ...board]);
  const holeRanks = hole.map(rankOf);
  const boardTop = Math.max(...board.map(rankOf));
  const outs: Out[] = [];

  for (const c of unseenCards) {
    const next = evaluate([...hole, ...board, c]);
    if (next.category <= current.category) continue;
    const newBoard = [...board, c];
    if (next.category <= boardOnlyCategory(newBoard)) continue;
    if (!next.best5.some((x) => hole.includes(x))) continue;
    const r = rankOf(c);
    if (next.category === HandCategory.OnePair && !(holeRanks.includes(r) && r >= boardTop)) continue;
    if ((next.category === HandCategory.TwoPair || next.category === HandCategory.Trips) && !holeRanks.includes(r)) continue;
    outs.push({ card: c, makes: next.category });
  }

  const unseen = unseenCards.length;
  const n = outs.length;
  const nextCardPct = n / unseen;
  const byRiverPct = board.length === 3 ? 1 - ((unseen - n) / unseen) * ((unseen - 1 - n) / (unseen - 1)) : nextCardPct;
  const groupMap = new Map<HandCategory, Card[]>();
  for (const o of outs) groupMap.set(o.makes, [...(groupMap.get(o.makes) ?? []), o.card]);
  const groups = [...groupMap.entries()].sort((a, b) => b[0] - a[0]).map(([category, cards]) => ({ category, cards }));
  return { current, outs, unseen, nextCardPct, byRiverPct, groups };
}

// ---------------------------------------------------------------- draws

export type DrawKind = 'flushDraw' | 'nutFlushDraw' | 'oesd' | 'gutshot' | 'doubleGutshot' | 'backdoorFlush' | 'overcards';

export interface Draw {
  kind: DrawKind;
  he: string;
  en: string;
  outs: number;
}

/** Ranks (2..14) that would complete a straight using at least one hole card. */
function straightCompletingRanks(hole: Card[], board: Card[]): number[] {
  if (evaluate([...hole, ...board]).category >= HandCategory.Straight) return [];
  const withLowAce = (rs: number[]) => rs.flatMap((r) => (r === 14 ? [14, 1] : [r]));
  const have = new Set(withLowAce([...hole, ...board].map(rankOf)));
  const holeRanks = new Set(withLowAce(hole.map(rankOf)));
  const out: number[] = [];
  for (let r = 2; r <= 14; r++) {
    if (have.has(r)) continue;
    const added = r === 14 ? [14, 1] : [r];
    const ranks = new Set([...have, ...added]);
    for (let top = 14; top >= 5; top--) {
      const window = [top, top - 1, top - 2, top - 3, top - 4];
      if (!window.every((x) => ranks.has(x))) continue;
      if (!window.some((x) => added.includes(x))) continue;
      if (window.some((x) => holeRanks.has(x) && !added.includes(x))) {
        out.push(r);
        break;
      }
    }
  }
  return out;
}

export function findDraws(hole: Card[], board: Card[]): Draw[] {
  if (board.length < 3 || board.length > 4) return [];
  const draws: Draw[] = [];
  const all = [...hole, ...board];
  const made = evaluate(all);

  if (made.category < HandCategory.Flush) {
    for (let s = 0; s < 4; s++) {
      const suited = all.filter((c) => suitOf(c) === s);
      const holeSuited = hole.filter((c) => suitOf(c) === s);
      if (!holeSuited.length) continue;
      if (suited.length === 4) {
        // Nut flush draw: hero holds the highest card of the suit that is not on the board.
        const boardRanks = board.filter((c) => suitOf(c) === s).map(rankOf);
        let topMissing = 14;
        while (boardRanks.includes(topMissing)) topMissing--;
        const nut = holeSuited.some((c) => rankOf(c) === topMissing);
        draws.push(nut
          ? { kind: 'nutFlushDraw', he: `Nut Flush Draw — דרו לצבע הכי חזק (${SUIT_SYMBOLS[s]})`, en: 'Nut Flush Draw', outs: 9 }
          : { kind: 'flushDraw', he: `Flush Draw — דרו לצבע (${SUIT_SYMBOLS[s]})`, en: 'Flush Draw', outs: 9 });
      } else if (suited.length === 3 && board.length === 3) {
        draws.push({ kind: 'backdoorFlush', he: `Backdoor Flush Draw — צריך שני קלפים ${SUIT_SYMBOLS[s]} ברצף (Turn וגם River)`, en: 'Backdoor Flush Draw', outs: 0 });
      }
    }
  }

  const sRanks = straightCompletingRanks(hole, board);
  if (sRanks.length >= 2) {
    // Distinguish open-ended (consecutive core) from double gutshot by checking for 4 in a row.
    const ranks = new Set(all.map(rankOf));
    let fourInRow = false;
    for (let lo = 1; lo <= 11; lo++) {
      const w = [lo, lo + 1, lo + 2, lo + 3].map((x) => (x === 1 ? 14 : x));
      if (w.every((x) => ranks.has(x))) fourInRow = true;
    }
    const names = sRanks.map(rankLabel).join(' או ');
    draws.push(fourInRow
      ? { kind: 'oesd', he: `Open-Ended Straight Draw — דרו לרצף פתוח משני הצדדים (צריך ${names})`, en: 'Open-Ended Straight Draw', outs: sRanks.length * 4 }
      : { kind: 'doubleGutshot', he: `Double Gutshot — שני "חורים" לרצף (צריך ${names})`, en: 'Double Gutshot', outs: sRanks.length * 4 });
  } else if (sRanks.length === 1) {
    draws.push({ kind: 'gutshot', he: `Gutshot — דרו לרצף פנימי (צריך ${rankLabel(sRanks[0])})`, en: 'Gutshot Straight Draw', outs: 4 });
  }

  if (made.category === HandCategory.HighCard) {
    const top = Math.max(...board.map(rankOf));
    const overs = hole.filter((c) => rankOf(c) > top);
    if (overs.length === 2) draws.push({ kind: 'overcards', he: 'Two Overcards — שני קלפים גבוהים מכל הלוח', en: 'Two Overcards', outs: 6 });
  }
  return draws;
}

// ---------------------------------------------------------------- made hand description

export interface MadeHandInfo {
  value: HandValue;
  /** Short Hebrew description with the English term. */
  he: string;
  /** Rough strength bucket used by the coach. */
  tier: 'monster' | 'strong' | 'medium' | 'weak' | 'air';
  playingTheBoard: boolean;
}

export function describeMadeHand(hole: Card[], board: Card[]): MadeHandInfo {
  const value = evaluate([...hole, ...board]);
  const name = `${CATEGORY_NAMES[value.category].he} (${handNameEn(value)})`;
  const holeR = hole.map(rankOf);
  const boardR = board.map(rankOf);
  const uniqBoard = [...new Set(boardR)].sort((a, b) => b - a);
  const playingTheBoard = board.length === 5 && evaluate(board).score === value.score;

  if (playingTheBoard) {
    return { value, he: `${name} — כל היד נמצאת על הלוח (Playing the Board). הקלפים שלך לא משפרים אותה, ולכן כל מי שנשאר ביד מתחלק איתך לפחות.`, tier: 'weak', playingTheBoard };
  }

  switch (value.category) {
    case HandCategory.HighCard: {
      const overs = holeR.filter((r) => r > uniqBoard[0]).length;
      return { value, he: `${name} — אין לך זוג.${overs ? ` ${overs === 2 ? 'שני הקלפים שלך' : 'קלף אחד שלך'} גבוה מכל הלוח (Overcard).` : ''}`, tier: 'air', playingTheBoard };
    }
    case HandCategory.OnePair: {
      const p = value.kickers[0];
      if (!holeR.includes(p)) {
        return { value, he: `${name} — הזוג נמצא על הלוח ומשותף לכולם; בפועל יש לך רק קלף גבוה.`, tier: 'air', playingTheBoard };
      }
      if (holeR[0] === holeR[1]) {
        if (p > uniqBoard[0]) return { value, he: `${name} — Overpair: זוג ביד שגבוה מכל קלפי הלוח.`, tier: 'strong', playingTheBoard };
        const above = uniqBoard.filter((r) => r > p).length;
        return { value, he: `${name} — Pocket Pair שנמצא מתחת ל-${above} קלפים בלוח (Underpair). כל יריב עם אחד מהם מוביל עליך.`, tier: above >= 2 ? 'weak' : 'medium', playingTheBoard };
      }
      const kicker = holeR.find((r) => r !== p) ?? 0;
      const idx = uniqBoard.indexOf(p);
      if (idx === 0) {
        const kickerText = kicker === 14 || (kicker === 13 && p === 14) ? 'Top Kicker — הקיקר הכי טוב' : kicker >= 11 ? `קיקר טוב (${rankLabel(kicker)})` : `קיקר חלש (${rankLabel(kicker)})`;
        return { value, he: `${name} — Top Pair: זוג עם הקלף הגבוה בלוח, ${kickerText}.`, tier: kicker >= 11 ? 'strong' : 'medium', playingTheBoard };
      }
      if (idx === 1) return { value, he: `${name} — Middle Pair: זוג עם הקלף האמצעי בלוח.`, tier: 'medium', playingTheBoard };
      return { value, he: `${name} — Bottom Pair: זוג עם קלף נמוך בלוח.`, tier: 'weak', playingTheBoard };
    }
    case HandCategory.TwoPair: {
      const [a, b] = value.kickers;
      const usesBoth = holeR.includes(a) && holeR.includes(b) && holeR[0] !== holeR[1];
      if (usesBoth) return { value, he: `${name} — שני זוגות ששניהם משתמשים בקלפים שלך. יד חזקה.`, tier: 'strong', playingTheBoard };
      return { value, he: `${name} — אחד הזוגות נמצא על הלוח (Board Pairing), כך שהיד חלשה ממה שהיא נראית.`, tier: 'medium', playingTheBoard };
    }
    case HandCategory.Trips: {
      const t = value.kickers[0];
      if (holeR[0] === holeR[1] && holeR[0] === t) return { value, he: `${name} — Set: זוג ביד + קלף שלישי בלוח. יד חזקה מאוד ומוסתרת.`, tier: 'monster', playingTheBoard };
      if (holeR.includes(t)) return { value, he: `${name} — Trips: קלף אחד שלך + זוג על הלוח. שימו לב לקיקר.`, tier: 'strong', playingTheBoard };
      return { value, he: `${name} — השלישייה על הלוח ומשותפת לכולם; הקיקר שלך קובע.`, tier: 'weak', playingTheBoard };
    }
    default: {
      const tier = value.category >= HandCategory.FullHouse ? 'monster' : 'strong';
      return { value, he: `${name}.`, tier, playingTheBoard };
    }
  }
}

// ---------------------------------------------------------------- board texture

export interface BoardTexture {
  paired: boolean;
  monotone: boolean;
  twoTone: boolean;
  rainbow: boolean;
  flushPossible: boolean;
  flushDrawPossible: boolean;
  straightPossible: boolean;
  connected: boolean;
  highCard: number;
  wetness: 'dry' | 'medium' | 'wet';
  he: string;
}

export function analyzeBoard(board: Card[]): BoardTexture {
  const ranks = board.map(rankOf);
  const suitCounts = [0, 0, 0, 0];
  for (const c of board) suitCounts[suitOf(c)]++;
  const maxSuit = Math.max(...suitCounts);
  const paired = new Set(ranks).size < ranks.length;
  const uniq = [...new Set(ranks.flatMap((r) => (r === 14 ? [14, 1] : [r])))].sort((a, b) => a - b);
  // Max number of distinct board ranks inside any 5-rank window.
  let maxInWindow = 0;
  for (let lo = 1; lo <= 10; lo++) maxInWindow = Math.max(maxInWindow, uniq.filter((r) => r >= lo && r <= lo + 4).length);
  const straightPossible = maxInWindow >= 3;
  const connected = maxInWindow >= 3 || (board.length === 3 && maxInWindow >= 2 && ranks.some((r, i) => ranks.some((q, j) => i !== j && Math.abs(r - q) === 1)));
  const flushPossible = maxSuit >= 3;
  const flushDrawPossible = board.length < 5 && maxSuit === 2;
  let score = 0;
  if (flushPossible) score += 2;
  else if (flushDrawPossible) score += 1;
  if (straightPossible) score += 2;
  else if (connected) score += 1;
  if (paired) score -= 1;
  const wetness = score >= 3 ? 'wet' : score >= 1 ? 'medium' : 'dry';

  const parts: string[] = [];
  parts.push(maxSuit === board.length && board.length >= 3 ? 'Monotone (כל הקלפים מאותו סוג)' : maxSuit >= 3 ? `${maxSuit} קלפים מאותו סוג — Flush אפשרי` : maxSuit === 2 ? 'Two-Tone (שני קלפים מאותו סוג — יש Flush Draws)' : 'Rainbow (כל הסוגים שונים)');
  if (paired) parts.push('לוח עם זוג (Paired Board) — Full House ו-Trips אפשריים');
  if (straightPossible) parts.push('Straight אפשרי או קרוב');
  else if (connected) parts.push('קלפים מחוברים (Connected)');
  const wetHe = wetness === 'wet' ? 'לוח רטוב (Wet) — הרבה דרואים, הידיים משתנות הרבה מרחוב לרחוב' : wetness === 'dry' ? 'לוח יבש (Dry) — מעט דרואים, מי שמוביל עכשיו בדרך כלל ימשיך להוביל' : 'לוח בינוני';
  return {
    paired,
    monotone: maxSuit === board.length,
    twoTone: maxSuit === 2,
    rainbow: maxSuit === 1,
    flushPossible,
    flushDrawPossible,
    straightPossible,
    connected,
    highCard: Math.max(...ranks),
    wetness,
    he: `${wetHe}. ${parts.join('; ')}.`,
  };
}

export const outsListText = (cards: Card[]): string => cards.map(cardToPretty).join(' ');
