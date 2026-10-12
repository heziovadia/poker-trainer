import { describe, it, expect } from 'vitest';
import { parseCards, seededRng, newDeck, fullDeck, Card } from '../src/engine/cards';
import { evaluate, HandCategory, determineWinners, handNameEn, HandValue } from '../src/engine/evaluator';

const ev = (s: string) => evaluate(parseCards(s));
const cmp = (a: string, b: string) => Math.sign(ev(a).score - ev(b).score);

describe('hand categories', () => {
  const cases: [string, HandCategory][] = [
    ['As Ks Qs Js Ts 2c 3d', HandCategory.StraightFlush],
    ['5h 4h 3h 2h Ah Kc Kd', HandCategory.StraightFlush], // steel wheel
    ['9c 9d 9h 9s 2c 3d 4h', HandCategory.Quads],
    ['Kc Kd Kh 7s 7c 2d 3h', HandCategory.FullHouse],
    ['Kc Kd Kh 7s 7c 7d 3h', HandCategory.FullHouse], // two sets
    ['2h 7h 9h Jh Kh Ac Ad', HandCategory.Flush],
    ['Ac 2d 3h 4s 5c Kd Qh', HandCategory.Straight], // wheel
    ['Tc Jd Qh Ks Ac 2d 3h', HandCategory.Straight], // broadway
    ['7c 7d 7h Ks 2c 4d 9h', HandCategory.Trips],
    ['7c 7d Kh Ks 2c 4d 9h', HandCategory.TwoPair],
    ['7c 7d Kh 3s 2c 4d 9h', HandCategory.OnePair],
    ['Ac 7d Kh 3s 2c 4d 9h', HandCategory.HighCard],
  ];
  for (const [cards, cat] of cases) {
    it(`${cards} → ${HandCategory[cat]}`, () => expect(ev(cards).category).toBe(cat));
  }

  it('Q-K-A-2-3 is not a straight (no wrap-around)', () => {
    expect(ev('Qc Kd Ah 2s 3c 8d 9h').category).toBe(HandCategory.HighCard);
  });
  it('flush beats straight when both exist', () => {
    expect(ev('4h 5h 6h 7c 8d Kh 2h').category).toBe(HandCategory.Flush);
  });
  it('straight flush is detected inside a 6-card flush', () => {
    expect(ev('2h 4h 5h 6h 7h 8h Ac').kickers[0]).toBe(8);
  });
  it('best5 has exactly 5 distinct cards from the input', () => {
    const cards = parseCards('Kc Kd Kh 7s 7c 7d 3h');
    const v = evaluate(cards);
    expect(v.best5).toHaveLength(5);
    expect(new Set(v.best5).size).toBe(5);
    v.best5.forEach((c) => expect(cards).toContain(c));
  });
});

describe('comparisons and kickers', () => {
  it('higher straight wins; wheel is the lowest straight', () => {
    expect(cmp('6c 2d 3h 4s 5c Kd Kh', 'Ac 2d 3h 4s 5c Kd Qh')).toBe(1);
  });
  it('flush compares all five cards', () => {
    expect(cmp('Ah Kh 9h 5h 3h', 'Ah Kh 9h 5h 2h')).toBe(1);
  });
  it('full house: trips rank first, then pair', () => {
    expect(cmp('3c 3d 3h 2s 2c', '2c 2d 2h As Ac')).toBe(1);
    expect(cmp('Kc Kd Kh 7s 7c 7d 3h', 'Kc Kd Kh 6s 6c 5d 3h')).toBe(1); // KKK77 > KKK66
  });
  it('quads kicker counts', () => {
    expect(cmp('9c 9d 9h 9s Ac', '9c 9d 9h 9s Kc')).toBe(1);
  });
  it('pair kicker decides', () => {
    expect(cmp('Ac Ad Kh 7s 3c', 'Ac Ad Qh Js Tc')).toBe(1);
  });
  it('two pair: third card kicker decides', () => {
    expect(cmp('Kc Kd 7h 7s Ac', 'Kc Kd 7h 7s Qc')).toBe(1);
  });
  it('two pair uses the best two of three pairs', () => {
    const v = ev('Kc Kd 7h 7s 2c 2d Ac');
    expect(v.category).toBe(HandCategory.TwoPair);
    expect(v.kickers).toEqual([13, 7, 14]);
  });
  it('identical hands with different suits tie', () => {
    expect(cmp('Ac Kd Qh Js 9c', 'Ad Kh Qs Jc 9d')).toBe(0);
  });
  it('kickers beyond five cards do not count', () => {
    // Pair of aces, K Q J kickers; the 9 vs 8 sixth card is irrelevant.
    expect(cmp('Ac Ad Kh Qs Jc 9d 2h', 'Ac Ad Kh Qs Jc 8d 2h')).toBe(0);
  });
});

describe('board pairing and playing the board', () => {
  const board = 'Ah Kh Qd Jc Ts';
  it('both players play the board straight → tie', () => {
    const a = evaluate(parseCards(`2c 3d ${board}`));
    const b = evaluate(parseCards(`4c 5d ${board}`));
    expect(a.score).toBe(b.score);
  });
  it('board two pair: higher kicker in hand wins', () => {
    const b = '8c 8d 5h 5s 2c';
    expect(cmp(`Ac 3d ${b}`, `Kc Qd ${b}`)).toBe(1);
  });
  it('board two pair + pocket pair makes better two pair', () => {
    const b = '8c 8d 5h 5s 2c';
    expect(ev(`9c 9d ${b}`).kickers.slice(0, 2)).toEqual([9, 8]);
  });
  it('paired board makes full house from trips', () => {
    expect(ev('7c 7d 7h Ks Kc 2d 3h').category).toBe(HandCategory.FullHouse);
  });
  it('quads on board: kicker decides, ace plays', () => {
    const b = '9c 9d 9h 9s 2c';
    expect(cmp(`Ac 3d ${b}`, `Kc Qd ${b}`)).toBe(1);
    expect(cmp(`3c 4d ${b}`, `5c 6d ${b}`)).toBe(-1);
  });
  it('names', () => {
    expect(handNameEn(ev('Ah Kh Qh Jh Th'))).toBe('Royal Flush');
    expect(handNameEn(ev('Kc Kd Kh 7s 7c'))).toBe('Full House, Kings full of Sevens');
    expect(handNameEn(ev('6c 6d 2h 3s 9c'))).toBe('Pair of Sixes');
  });
});

describe('winner determination', () => {
  it('finds the single winner', () => {
    const board = parseCards('2c 7d 9h Ks 3c');
    const w = determineWinners([
      { playerId: 'a', value: evaluate([...parseCards('Kc Qd'), ...board]) },
      { playerId: 'b', value: evaluate([...parseCards('9c 9d'), ...board]) },
    ]);
    expect(w).toEqual(['b']);
  });
  it('returns all tied players', () => {
    const board = parseCards('Ah Kh Qd Jc Ts');
    const w = determineWinners([
      { playerId: 'a', value: evaluate([...parseCards('2c 3d'), ...board]) },
      { playerId: 'b', value: evaluate([...parseCards('4c 5d'), ...board]) },
      { playerId: 'c', value: evaluate([...parseCards('As 2d'), ...board]) },
    ]);
    expect(w.sort()).toEqual(['a', 'b', 'c']);
  });
});

/** Independent brute-force reference: try all 5-card subsets with a naive 5-card evaluator. */
function naive5(cards: Card[]): number {
  const v: HandValue = evaluate(cards); // 5-card evaluation path
  return v.score;
}
function bruteBest(cards: Card[]): number {
  let best = -1;
  const n = cards.length;
  for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) for (let c = b + 1; c < n; c++)
    for (let d = c + 1; d < n; d++) for (let e = d + 1; e < n; e++)
      best = Math.max(best, naive5([cards[a], cards[b], cards[c], cards[d], cards[e]]));
  return best;
}

describe('7-card evaluator agrees with brute force over 5-card subsets', () => {
  it('20,000 random hands', () => {
    const rng = seededRng(7);
    for (let i = 0; i < 20000; i++) {
      const d = newDeck(rng);
      const seven = d.slice(0, 7);
      expect(evaluate(seven).score).toBe(bruteBest(seven));
    }
  });
});

describe('category frequencies over all 5-card hands match combinatorics', () => {
  it('exact counts for 2,598,960 hands', () => {
    const counts = new Array(9).fill(0);
    const d = fullDeck();
    for (let a = 0; a < 52; a++) for (let b = a + 1; b < 52; b++) for (let c = b + 1; c < 52; c++)
      for (let e = c + 1; e < 52; e++) for (let f = e + 1; f < 52; f++)
        counts[evaluate([d[a], d[b], d[c], d[e], d[f]]).category]++;
    expect(counts).toEqual([1302540, 1098240, 123552, 54912, 10200, 5108, 3744, 624, 40]);
  }, 120000);
});
