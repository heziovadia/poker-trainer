/** The 169 starting-hand classes (AA, AKs, AKo, ...) and preflop strength ordering. */
import { Card, RANK_CHARS, rankOf, suitOf, makeCard } from './cards';
import { PREFLOP_ORDER } from './preflopTable';

export type HandClass = string; // e.g. "AKs", "T9o", "77"

export function classOf(hole: readonly Card[]): HandClass {
  const [a, b] = hole;
  const ra = rankOf(a);
  const rb = rankOf(b);
  const hi = Math.max(ra, rb);
  const lo = Math.min(ra, rb);
  const h = RANK_CHARS[hi - 2];
  const l = RANK_CHARS[lo - 2];
  if (hi === lo) return h + l;
  return h + l + (suitOf(a) === suitOf(b) ? 's' : 'o');
}

export function allClasses(): HandClass[] {
  const out: HandClass[] = [];
  for (let i = 12; i >= 0; i--) {
    for (let j = 12; j >= 0; j--) {
      const hi = RANK_CHARS[Math.max(i, j)];
      const lo = RANK_CHARS[Math.min(i, j)];
      if (i === j) out.push(hi + lo);
      else if (i > j) out.push(hi + lo + 's');
      else out.push(hi + lo + 'o');
    }
  }
  return [...new Set(out)];
}

export const comboCount = (cls: HandClass): number => (cls.length === 2 ? 6 : cls[2] === 's' ? 4 : 12);

/** All concrete two-card combos of a class, skipping dead cards. */
export function combosOf(cls: HandClass, dead: ReadonlySet<Card> = new Set()): Card[][] {
  const r1 = RANK_CHARS.indexOf(cls[0]) + 2;
  const r2 = RANK_CHARS.indexOf(cls[1]) + 2;
  const out: Card[][] = [];
  for (let s1 = 0; s1 < 4; s1++) {
    for (let s2 = 0; s2 < 4; s2++) {
      if (cls.length === 2 && s2 <= s1) continue;
      if (cls[2] === 's' && s1 !== s2) continue;
      if (cls[2] === 'o' && s1 === s2) continue;
      const c1 = makeCard(r1, s1);
      const c2 = makeCard(r2, s2);
      if (dead.has(c1) || dead.has(c2)) continue;
      out.push([c1, c2]);
    }
  }
  return out;
}

const RANK_INDEX = new Map<HandClass, number>(PREFLOP_ORDER.map((c, i) => [c, i]));

/** 0 = best class (AA) ... 168 = worst. */
export const preflopRankIndex = (cls: HandClass): number => RANK_INDEX.get(cls) ?? 168;

const CUMULATIVE: Map<HandClass, number> = (() => {
  const m = new Map<HandClass, number>();
  let acc = 0;
  for (const c of PREFLOP_ORDER) {
    acc += comboCount(c);
    m.set(c, acc / 1326);
  }
  return m;
})();

/**
 * Fraction of all 1326 starting combos that are as good as or better than this class.
 * AA → 0.5%, 72o → 100%. "Top 15%" ranges are built from this.
 */
export const preflopPercentile = (cls: HandClass): number => CUMULATIVE.get(cls) ?? 1;

/** Classes making up the top `pct` (0..1) of starting hands. */
export function topRange(pct: number): HandClass[] {
  return PREFLOP_ORDER.filter((c) => (CUMULATIVE.get(c) ?? 1) <= pct + 1e-9);
}

export function isPair(cls: HandClass): boolean {
  return cls.length === 2;
}
export function isSuited(cls: HandClass): boolean {
  return cls[2] === 's';
}
export function gapOf(cls: HandClass): number {
  return Math.abs(RANK_CHARS.indexOf(cls[0]) - RANK_CHARS.indexOf(cls[1])) - 1;
}

/**
 * Compact text for a list of classes, e.g. "77+, AJs+, KQs, AQo+".
 * Good enough for teaching; it groups pairs and same-high-card runs.
 */
export function describeRange(classes: HandClass[]): string {
  const set = new Set(classes);
  const parts: string[] = [];
  const R = RANK_CHARS;
  // Pairs
  const pairs = [...R].reverse().filter((r) => set.has(r + r));
  if (pairs.length) {
    const lowest = pairs[pairs.length - 1];
    const contiguous = pairs.every((r, i) => R.indexOf(r) === 12 - i);
    parts.push(contiguous ? (lowest === 'A' ? 'AA' : `${lowest}${lowest}+`) : pairs.map((r) => r + r).join(', '));
  }
  // Non-pairs grouped by high card and suitedness
  for (const suf of ['s', 'o']) {
    for (let hi = 12; hi >= 1; hi--) {
      const h = R[hi];
      const kickers: string[] = [];
      for (let lo = hi - 1; lo >= 0; lo--) if (set.has(h + R[lo] + suf)) kickers.push(R[lo]);
      if (!kickers.length) continue;
      const topContig = kickers.every((k, i) => R.indexOf(k) === hi - 1 - i);
      if (topContig && kickers.length > 1) parts.push(`${h}${kickers[kickers.length - 1]}${suf}+`);
      else if (kickers.length > 3) parts.push(`${h}x${suf} (${kickers.length})`);
      else parts.push(...kickers.map((k) => h + k + suf));
    }
  }
  return parts.join(', ');
}
