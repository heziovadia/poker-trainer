/**
 * Card primitives. A card is an integer 0..51:
 *   rank index = card >> 2  (0 = deuce ... 12 = ace)
 *   suit index = card & 3   (0 = clubs, 1 = diamonds, 2 = hearts, 3 = spades)
 * Integers keep evaluation fast and make duplicate detection trivial.
 */
export type Card = number;

export const RANK_CHARS = '23456789TJQKA';
export const SUIT_CHARS = 'cdhs';
export const SUIT_SYMBOLS = ['♣', '♦', '♥', '♠'];
export const SUIT_NAMES_HE = ['תלתן', 'יהלום', 'לב', 'עלה'];

/** Rank value 2..14 (ace = 14). */
export const rankOf = (c: Card): number => (c >> 2) + 2;
export const suitOf = (c: Card): number => c & 3;
export const makeCard = (rank: number, suit: number): Card => ((rank - 2) << 2) | suit;

export function parseCard(s: string): Card {
  if (s.length !== 2) throw new Error(`Bad card: ${s}`);
  const r = RANK_CHARS.indexOf(s[0].toUpperCase());
  const su = SUIT_CHARS.indexOf(s[1].toLowerCase());
  if (r < 0 || su < 0) throw new Error(`Bad card: ${s}`);
  return (r << 2) | su;
}

/** Parse "As Kd 7h" or "AsKd7h". */
export function parseCards(s: string): Card[] {
  const clean = s.replace(/[\s,]+/g, '');
  const out: Card[] = [];
  for (let i = 0; i < clean.length; i += 2) out.push(parseCard(clean.slice(i, i + 2)));
  return out;
}

export const cardToString = (c: Card): string => RANK_CHARS[c >> 2] + SUIT_CHARS[c & 3];
export const cardToPretty = (c: Card): string => rankLabel(rankOf(c)) + SUIT_SYMBOLS[suitOf(c)];
export const cardsToPretty = (cs: Card[]): string => cs.map(cardToPretty).join(' ');

export function rankLabel(rank: number): string {
  return rank === 10 ? '10' : RANK_CHARS[rank - 2];
}

export const RANK_NAMES_EN: Record<number, string> = {
  2: 'Deuce', 3: 'Three', 4: 'Four', 5: 'Five', 6: 'Six', 7: 'Seven', 8: 'Eight',
  9: 'Nine', 10: 'Ten', 11: 'Jack', 12: 'Queen', 13: 'King', 14: 'Ace',
};

export function fullDeck(): Card[] {
  return Array.from({ length: 52 }, (_, i) => i);
}

/** Random source returning a float in [0, 1). Injectable for deterministic tests. */
export type Rng = () => number;

/** Mulberry32 — small seeded PRNG for reproducible tests and simulations. */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Cryptographically strong RNG for real play when available. */
export function defaultRng(): Rng {
  const c = globalThis.crypto;
  if (c && typeof c.getRandomValues === 'function') {
    const buf = new Uint32Array(1);
    return () => {
      c.getRandomValues(buf);
      return buf[0] / 4294967296;
    };
  }
  return Math.random;
}

/** Fisher–Yates shuffle (returns a new array). */
export function shuffle<T>(arr: readonly T[], rng: Rng): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** A shuffled deck, optionally with some cards removed (e.g. already dealt). */
export function newDeck(rng: Rng, exclude: readonly Card[] = []): Card[] {
  const ex = new Set(exclude);
  return shuffle(fullDeck().filter((c) => !ex.has(c)), rng);
}

export function hasDuplicates(cards: readonly Card[]): boolean {
  return new Set(cards).size !== cards.length;
}
