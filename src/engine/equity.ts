/** Monte Carlo equity against random hands or weighted ranges. */
import { Card, Rng, fullDeck } from './cards';
import { evaluate } from './evaluator';

export interface WeightedCombo {
  cards: [Card, Card];
  weight: number;
}

/** An opponent is either "any two cards" (null) or a weighted range. */
export type OpponentRange = WeightedCombo[] | null;

export interface EquityResult {
  /** Hero equity 0..1 (ties count as a share of the pot). */
  equity: number;
  wins: number;
  ties: number;
  losses: number;
  iterations: number;
}

function pickWeighted(range: WeightedCombo[], total: number, rng: Rng): WeightedCombo {
  let x = rng() * total;
  for (const c of range) {
    x -= c.weight;
    if (x <= 0) return c;
  }
  return range[range.length - 1];
}

export interface EquityInput {
  hero: Card[];
  board: Card[];
  opponents: OpponentRange[];
  iterations?: number;
  rng: Rng;
}

export function equity({ hero, board, opponents, iterations = 1500, rng }: EquityInput): EquityResult {
  const dead = new Set<Card>([...hero, ...board]);
  const ranges = opponents.map((r) => {
    if (!r) return null;
    const live = r.filter((c) => !dead.has(c.cards[0]) && !dead.has(c.cards[1]) && c.weight > 0);
    return { live, total: live.reduce((s, c) => s + c.weight, 0) };
  });
  const baseDeck = fullDeck().filter((c) => !dead.has(c));
  const need = 5 - board.length;

  let wins = 0;
  let ties = 0;
  let losses = 0;
  let share = 0;
  let done = 0;

  for (let it = 0; it < iterations; it++) {
    const used = new Set<Card>();
    const oppHands: Card[][] = [];
    let ok = true;
    for (const r of ranges) {
      if (r && r.live.length) {
        let picked: WeightedCombo | null = null;
        for (let tries = 0; tries < 20; tries++) {
          const c = pickWeighted(r.live, r.total, rng);
          if (!used.has(c.cards[0]) && !used.has(c.cards[1])) {
            picked = c;
            break;
          }
        }
        if (!picked) {
          ok = false;
          break;
        }
        used.add(picked.cards[0]);
        used.add(picked.cards[1]);
        oppHands.push(picked.cards);
      } else {
        oppHands.push([]); // filled from the deck below
      }
    }
    if (!ok) continue;

    // Draw random cards for unknown opponents and the rest of the board.
    const deck = baseDeck.filter((c) => !used.has(c));
    let top = deck.length;
    const draw = (): Card => {
      const j = Math.floor(rng() * top);
      top--;
      const c = deck[j];
      deck[j] = deck[top];
      deck[top] = c;
      return c;
    };
    for (const h of oppHands) if (h.length === 0) h.push(draw(), draw());
    const fullBoard = board.slice();
    for (let i = 0; i < need; i++) fullBoard.push(draw());

    const heroScore = evaluate([...hero, ...fullBoard]).score;
    let tiedWith = 0;
    let lost = false;
    for (const h of oppHands) {
      const sc = evaluate([...h, ...fullBoard]).score;
      if (sc > heroScore) {
        lost = true;
        break;
      }
      if (sc === heroScore) tiedWith++;
    }
    done++;
    if (lost) losses++;
    else if (tiedWith > 0) {
      ties++;
      share += 1 / (tiedWith + 1);
    } else wins++;
  }
  const n = Math.max(1, done);
  return { equity: (wins + share) / n, wins, ties, losses, iterations: done };
}

/** Exact head-to-head result of the current hand against every possible opponent holding. */
export interface RelativeStrength {
  beats: number;
  ties: number;
  losesTo: number;
  total: number;
  /** Share of possible holdings hero is ahead of right now (ties count half). */
  pct: number;
}

export function relativeStrength(hero: Card[], board: Card[]): RelativeStrength {
  if (board.length < 3) throw new Error('relativeStrength needs a flop');
  const dead = new Set<Card>([...hero, ...board]);
  const rest = fullDeck().filter((c) => !dead.has(c));
  const heroScore = evaluate([...hero, ...board]).score;
  let beats = 0;
  let ties = 0;
  let losesTo = 0;
  for (let i = 0; i < rest.length; i++) {
    for (let j = i + 1; j < rest.length; j++) {
      const sc = evaluate([rest[i], rest[j], ...board]).score;
      if (sc < heroScore) beats++;
      else if (sc === heroScore) ties++;
      else losesTo++;
    }
  }
  const total = beats + ties + losesTo;
  return { beats, ties, losesTo, total, pct: (beats + ties / 2) / total };
}
