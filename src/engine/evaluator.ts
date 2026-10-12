import { Card, rankOf, suitOf, RANK_NAMES_EN } from './cards';

/** Hand categories, higher is better. */
export enum HandCategory {
  HighCard = 0,
  OnePair = 1,
  TwoPair = 2,
  Trips = 3,
  Straight = 4,
  Flush = 5,
  FullHouse = 6,
  Quads = 7,
  StraightFlush = 8,
}

export const CATEGORY_NAMES: Record<HandCategory, { en: string; he: string }> = {
  [HandCategory.HighCard]: { en: 'High Card', he: 'קלף גבוה' },
  [HandCategory.OnePair]: { en: 'One Pair', he: 'זוג' },
  [HandCategory.TwoPair]: { en: 'Two Pair', he: 'שני זוגות' },
  [HandCategory.Trips]: { en: 'Three of a Kind', he: 'שלישייה' },
  [HandCategory.Straight]: { en: 'Straight', he: 'רצף' },
  [HandCategory.Flush]: { en: 'Flush', he: 'צבע' },
  [HandCategory.FullHouse]: { en: 'Full House', he: 'פול האוס' },
  [HandCategory.Quads]: { en: 'Four of a Kind', he: 'רביעייה' },
  [HandCategory.StraightFlush]: { en: 'Straight Flush', he: 'רצף בצבע' },
};

export interface HandValue {
  category: HandCategory;
  /** Tie-break ranks in significance order (values 2..14). */
  kickers: number[];
  /** Single comparable number: larger = better. */
  score: number;
  /** The five cards forming the best hand. */
  best5: Card[];
}

function encode(category: number, ranks: number[]): number {
  let s = category;
  for (let i = 0; i < 5; i++) s = s * 15 + (ranks[i] ?? 0);
  return s;
}

/** Finds the highest straight in a rank bitmask (bit r set for rank r, 2..14). Returns top rank or 0. */
function straightTop(mask: number): number {
  // Treat ace as 1 as well for the wheel.
  const m = mask | (mask & (1 << 14) ? 1 << 1 : 0);
  for (let top = 14; top >= 5; top--) {
    const need = 0b11111 << (top - 4);
    if ((m & need) === need) return top;
  }
  return 0;
}

function pickByRank(cards: Card[], rank: number, n: number, used: Set<Card>): Card[] {
  const out: Card[] = [];
  for (const c of cards) {
    if (out.length === n) break;
    if (rankOf(c) === rank && !used.has(c)) {
      out.push(c);
      used.add(c);
    }
  }
  return out;
}

function straightCards(cards: Card[], top: number): Card[] {
  const ranks = top === 5 ? [5, 4, 3, 2, 14] : [top, top - 1, top - 2, top - 3, top - 4];
  return ranks.map((r) => cards.find((c) => rankOf(c) === r)!);
}

/**
 * Evaluates the best 5-card poker hand from 5 to 7 cards.
 * Written directly (not by brute force) for speed; tests cross-check it against brute force.
 */
export function evaluate(cards: readonly Card[]): HandValue {
  if (cards.length < 5 || cards.length > 7) throw new Error(`evaluate needs 5-7 cards, got ${cards.length}`);
  const sorted = [...cards].sort((a, b) => rankOf(b) - rankOf(a));

  const rankCount = new Array<number>(15).fill(0);
  const suitCount = [0, 0, 0, 0];
  let rankMask = 0;
  const suitMask = [0, 0, 0, 0];
  for (const c of sorted) {
    const r = rankOf(c);
    const s = suitOf(c);
    rankCount[r]++;
    suitCount[s]++;
    rankMask |= 1 << r;
    suitMask[s] |= 1 << r;
  }

  // Flush / straight flush
  const flushSuit = suitCount.findIndex((n) => n >= 5);
  if (flushSuit >= 0) {
    const suited = sorted.filter((c) => suitOf(c) === flushSuit);
    const sfTop = straightTop(suitMask[flushSuit]);
    if (sfTop) {
      return { category: HandCategory.StraightFlush, kickers: [sfTop], score: encode(8, [sfTop]), best5: straightCards(suited, sfTop) };
    }
  }

  // Group ranks by count, ordered by count desc then rank desc.
  const groups: { rank: number; count: number }[] = [];
  for (let r = 14; r >= 2; r--) if (rankCount[r]) groups.push({ rank: r, count: rankCount[r] });
  groups.sort((a, b) => b.count - a.count || b.rank - a.rank);

  const used = new Set<Card>();
  const kickersFrom = (exclude: number[], n: number): number[] => {
    const out: number[] = [];
    for (let r = 14; r >= 2 && out.length < n; r--) if (rankCount[r] && !exclude.includes(r)) out.push(r);
    return out;
  };
  const kickerCards = (ranks: number[]): Card[] => ranks.flatMap((r) => pickByRank(sorted, r, 1, used));

  if (groups[0].count === 4) {
    const q = groups[0].rank;
    const k = kickersFrom([q], 1);
    const best5 = [...pickByRank(sorted, q, 4, used), ...kickerCards(k)];
    return { category: HandCategory.Quads, kickers: [q, ...k], score: encode(7, [q, ...k]), best5 };
  }

  if (groups[0].count === 3 && groups.length > 1) {
    const t = groups[0].rank;
    // Best pair among remaining groups with count >= 2 (could be a second set).
    const pairRank = groups.slice(1).filter((g) => g.count >= 2).map((g) => g.rank).sort((a, b) => b - a)[0];
    if (pairRank) {
      const best5 = [...pickByRank(sorted, t, 3, used), ...pickByRank(sorted, pairRank, 2, used)];
      return { category: HandCategory.FullHouse, kickers: [t, pairRank], score: encode(6, [t, pairRank]), best5 };
    }
  }

  if (flushSuit >= 0) {
    const suited = sorted.filter((c) => suitOf(c) === flushSuit).slice(0, 5);
    const ks = suited.map(rankOf);
    return { category: HandCategory.Flush, kickers: ks, score: encode(5, ks), best5: suited };
  }

  const sTop = straightTop(rankMask);
  if (sTop) {
    return { category: HandCategory.Straight, kickers: [sTop], score: encode(4, [sTop]), best5: straightCards(sorted, sTop) };
  }

  if (groups[0].count === 3) {
    const t = groups[0].rank;
    const k = kickersFrom([t], 2);
    const best5 = [...pickByRank(sorted, t, 3, used), ...kickerCards(k)];
    return { category: HandCategory.Trips, kickers: [t, ...k], score: encode(3, [t, ...k]), best5 };
  }

  if (groups[0].count === 2 && groups[1]?.count === 2) {
    const p1 = groups[0].rank;
    const p2 = groups[1].rank;
    const k = kickersFrom([p1, p2], 1);
    const best5 = [...pickByRank(sorted, p1, 2, used), ...pickByRank(sorted, p2, 2, used), ...kickerCards(k)];
    return { category: HandCategory.TwoPair, kickers: [p1, p2, ...k], score: encode(2, [p1, p2, ...k]), best5 };
  }

  if (groups[0].count === 2) {
    const p = groups[0].rank;
    const k = kickersFrom([p], 3);
    const best5 = [...pickByRank(sorted, p, 2, used), ...kickerCards(k)];
    return { category: HandCategory.OnePair, kickers: [p, ...k], score: encode(1, [p, ...k]), best5 };
  }

  const k = kickersFrom([], 5);
  return { category: HandCategory.HighCard, kickers: k, score: encode(0, k), best5: kickerCards(k) };
}

export function compareHands(a: HandValue, b: HandValue): number {
  return a.score - b.score;
}

const plural = (r: number) => (r === 6 ? 'Sixes' : RANK_NAMES_EN[r] + 's');

/** English name of a made hand, e.g. "Two Pair, Kings and Sevens". */
export function handNameEn(v: HandValue): string {
  const k = v.kickers;
  switch (v.category) {
    case HandCategory.StraightFlush:
      return k[0] === 14 ? 'Royal Flush' : `Straight Flush, ${RANK_NAMES_EN[k[0]]} high`;
    case HandCategory.Quads: return `Four of a Kind, ${plural(k[0])}`;
    case HandCategory.FullHouse: return `Full House, ${plural(k[0])} full of ${plural(k[1])}`;
    case HandCategory.Flush: return `Flush, ${RANK_NAMES_EN[k[0]]} high`;
    case HandCategory.Straight: return `Straight, ${RANK_NAMES_EN[k[0]]} high`;
    case HandCategory.Trips: return `Three of a Kind, ${plural(k[0])}`;
    case HandCategory.TwoPair: return `Two Pair, ${plural(k[0])} and ${plural(k[1])}`;
    case HandCategory.OnePair: return `Pair of ${plural(k[0])}`;
    default: return `High Card, ${RANK_NAMES_EN[k[0]]}`;
  }
}

/** Hebrew + English label, e.g. "שני זוגות (Two Pair, Kings and Sevens)". */
export function handNameHe(v: HandValue): string {
  return `${CATEGORY_NAMES[v.category].he} (${handNameEn(v)})`;
}

export interface ShowdownEntry {
  playerId: string;
  value: HandValue;
}

/** Returns ids of the winners (ties included) among the given entries. */
export function determineWinners(entries: ShowdownEntry[]): string[] {
  if (!entries.length) return [];
  const best = Math.max(...entries.map((e) => e.value.score));
  return entries.filter((e) => e.value.score === best).map((e) => e.playerId);
}
