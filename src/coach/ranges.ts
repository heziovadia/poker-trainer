/**
 * Opponent range estimation from public information only: position, visible playing style,
 * and the actions taken on each street.
 */
import { Card, rankOf, suitOf } from '../engine/cards';
import { PlayerView, Street, Position } from '../engine/game';
import { allClasses, combosOf, preflopPercentile, describeRange, HandClass } from '../engine/handClasses';
import { evaluate, HandCategory } from '../engine/evaluator';
import { WeightedCombo } from '../engine/equity';
import { profileOf, OPEN_RANGE } from '../bots/profiles';

export type PreflopLine = 'open' | 'limp' | 'callRaise' | 'threeBet' | 'fourBet' | 'blindCheck' | 'blindCall' | 'unknown';

export type StrengthBucket = 'strong' | 'medium' | 'draw' | 'air';

export interface RangeEstimate {
  playerId: string;
  name: string;
  combos: WeightedCombo[];
  preflopLine: PreflopLine;
  preflopText: string;
  /** Weighted share of the range in each bucket on the current board. */
  buckets: Record<StrengthBucket, number>;
  /** Raw weighted combo counts behind `buckets` (for showing the calculation). */
  bucketWeights: Record<StrengthBucket, number>;
  totalWeight: number;
  explanation: string[];
}

const LINE_HE: Record<PreflopLine, string> = {
  open: 'פתח ב-Raise לפני הפלופ',
  limp: 'נכנס ב-Limp (רק השווה לביג בליינד)',
  callRaise: 'עשה Call ל-Raise',
  threeBet: 'עשה 3-Bet (העלאה חוזרת)',
  fourBet: 'עשה 4-Bet ומעלה',
  blindCheck: 'בדק (Check) מהביג בליינד בלי להשקיע עוד',
  blindCall: 'השלים מהבליינד',
  unknown: 'פעולה לא ברורה',
};

function preflopLineOf(view: PlayerView, id: string): PreflopLine {
  let raisesBefore = 0;
  let line = 'unknown' as PreflopLine;
  for (const l of view.log) {
    if (l.street !== 'preflop') continue;
    if (l.playerId === id) {
      if (l.action === 'raise') {
        line = raisesBefore === 0 ? 'open' : raisesBefore === 1 ? 'threeBet' : 'fourBet';
      } else if (l.action === 'call') {
        if (raisesBefore === 0) line = 'limp';
        else if (line !== 'open' && line !== 'threeBet') line = 'callRaise';
      } else if (l.action === 'check') {
        line = 'blindCheck';
      }
    }
    if (l.action === 'raise') raisesBefore++;
  }
  const pos = view.players.find((p) => p.id === id)?.position;
  if (line === 'limp' && pos === 'SB') return 'blindCall';
  return line;
}

/** Preflop weight of a class for a given line (0..1). */
function preflopWeight(pct: number, line: PreflopLine, pos: Position, mult: number): number {
  const w = (lo: number, hi: number) => (pct <= hi * mult ? (pct >= lo * mult ? 1 : 0.25) : 0);
  switch (line) {
    case 'open': return pct <= Math.min(0.85, (OPEN_RANGE[pos] ?? 0.2) * mult) ? 1 : 0;
    case 'limp': return pct <= Math.min(0.9, 0.45 * mult) ? (pct < 0.06 ? 0.3 : 1) : 0;
    case 'blindCall': return pct <= Math.min(0.95, 0.6 * mult) ? 1 : 0;
    case 'callRaise': return pos === 'BB' ? w(0.04, 0.4) : w(0.04, 0.2);
    case 'threeBet': return pct <= Math.min(0.3, 0.07 * mult) ? 1 : 0;
    case 'fourBet': return pct <= Math.min(0.1, 0.03 * mult) ? 1 : 0;
    case 'blindCheck': return pct < 0.08 ? 0.3 : 1;
    default: return pct <= 0.5 ? 1 : 0.3;
  }
}

/** Quick strength bucket of a holding on a board. */
export function bucketOf(hole: Card[], board: Card[]): StrengthBucket {
  const v = evaluate([...hole, ...board]);
  const holeR = hole.map(rankOf);
  const boardR = board.map(rankOf);
  const top = Math.max(...boardR);
  if (v.category >= HandCategory.TwoPair) {
    // Two pair is only strong when both pairs use the player's own cards; with a board pair it is
    // really one pair, and with two board pairs it is just a kicker.
    if (v.category === HandCategory.TwoPair) {
      const own = [v.kickers[0], v.kickers[1]].filter((r) => holeR.includes(r) && !(boardR.filter((b) => b === r).length >= 2)).length;
      if (own === 2 && holeR[0] !== holeR[1]) return 'strong';
      if (own === 0) return 'air';
      const p = [v.kickers[0], v.kickers[1]].find((r) => holeR.includes(r))!;
      return p >= top ? 'strong' : 'medium';
    }
    if (v.category === HandCategory.Trips && !holeR.includes(v.kickers[0])) return 'air';
    if (board.length === 5 && evaluate(board).score === v.score) return 'air';
    return 'strong';
  }
  if (v.category === HandCategory.OnePair) {
    const p = v.kickers[0];
    if (holeR.includes(p)) {
      if (p >= top && (holeR[0] === holeR[1] || Math.max(...holeR.filter((r) => r !== p), 0) >= 10 || p === 14)) return 'strong';
      return 'medium';
    }
  }
  if (board.length < 5) {
    const all = [...hole, ...board];
    for (let s = 0; s < 4; s++) {
      if (all.filter((c) => suitOf(c) === s).length >= 4 && hole.some((c) => suitOf(c) === s)) return 'draw';
    }
    const ranks = new Set(all.map(rankOf).flatMap((r) => (r === 14 ? [14, 1] : [r])));
    for (let lo = 1; lo <= 11; lo++) {
      if ([lo, lo + 1, lo + 2, lo + 3].every((r) => ranks.has(r)) && holeR.some((r) => r >= lo && r <= lo + 3)) return 'draw';
    }
  }
  return 'air';
}

const POSTFLOP_WEIGHTS: Record<string, Record<StrengthBucket, number>> = {
  bet: { strong: 1, medium: 0.4, draw: 0.65, air: 0.18 },
  raise: { strong: 1, medium: 0.15, draw: 0.45, air: 0.08 },
  call: { strong: 0.55, medium: 1, draw: 0.9, air: 0.1 },
  check: { strong: 0.35, medium: 0.9, draw: 0.75, air: 1 },
};

const BOARD_LEN: Record<Street, number> = { preflop: 0, flop: 3, turn: 4, river: 5, showdown: 5 };

export function estimateRange(view: PlayerView, playerId: string): RangeEstimate {
  const player = view.players.find((p) => p.id === playerId)!;
  const prof = profileOf(player.profile);
  const mult = prof.rangeMultiplier;
  const line = preflopLineOf(view, playerId);
  const dead = new Set<Card>([...view.myHole, ...view.board]);
  const explanation: string[] = [];

  let combos: WeightedCombo[] = [];
  const preClasses: HandClass[] = [];
  for (const cls of allClasses()) {
    const w = preflopWeight(preflopPercentile(cls), line, player.position, mult);
    if (w <= 0) continue;
    if (w >= 0.5) preClasses.push(cls);
    for (const c of combosOf(cls, dead)) combos.push({ cards: c as [Card, Card], weight: w });
  }
  const share = combos.reduce((s, c) => s + c.weight, 0) / 1326;
  const preflopText = describeRange(preClasses);
  explanation.push(`${player.name} (${player.position}, סגנון ${prof.he}/${prof.en}) ${LINE_HE[line]} → בערך ${Math.round(share * 100)}% מהידיים (${Math.round(share * 1326)} ÷ 1,326 צירופים).`);

  // Postflop narrowing street by street.
  for (const street of ['flop', 'turn', 'river'] as Street[]) {
    const acts = view.log.filter((l) => l.street === street && l.playerId === playerId);
    if (!acts.length) continue;
    const board = view.board.slice(0, BOARD_LEN[street]);
    const last = acts[acts.length - 1].action;
    const kind = last === 'raise' ? 'raise' : last === 'bet' ? 'bet' : last === 'call' ? 'call' : last === 'check' ? 'check' : null;
    if (!kind) continue;
    const ws = { ...POSTFLOP_WEIGHTS[kind] };
    if (kind === 'bet' || kind === 'raise') ws.air *= 0.5 + prof.bluff * 3; // aggressive players bluff more
    combos = combos.map((c) => ({ ...c, weight: c.weight * ws[bucketOf(c.cards, board)] }));
    const streetHe = street === 'flop' ? 'בפלופ' : street === 'turn' ? 'בטרן' : 'בריבר';
    const kindHe = { bet: 'הימר (Bet)', raise: 'העלה (Raise)', call: 'שילם (Call)', check: 'בדק (Check)' }[kind];
    const meaning = {
      bet: 'הימור מחזק את הטווח: יותר ידיים חזקות ודרואים, פחות ידיים חלשות (אבל יש גם בלופים).',
      raise: 'רייז הוא הפעולה החזקה ביותר: הטווח נוטה מאוד לידיים חזקות.',
      call: 'Call מראה בדרך כלל יד בינונית או דרו — חזקה מספיק להמשיך, לא מספיק כדי להעלות.',
      check: 'Check מחליש את הטווח: בדרך כלל אין לו יד חזקה (לפעמים הוא מסתתר עם יד חזקה — Slowplay).',
    }[kind];
    explanation.push(`${streetHe} ${kindHe}: ${meaning}`);
  }

  const buckets: Record<StrengthBucket, number> = { strong: 0, medium: 0, draw: 0, air: 0 };
  const bucketWeights: Record<StrengthBucket, number> = { strong: 0, medium: 0, draw: 0, air: 0 };
  let totalWeight = 0;
  if (view.board.length >= 3) {
    for (const c of combos) {
      if (c.weight <= 0) continue;
      bucketWeights[bucketOf(c.cards, view.board)] += c.weight;
      totalWeight += c.weight;
    }
    if (totalWeight > 0) for (const k of Object.keys(buckets) as StrengthBucket[]) buckets[k] = bucketWeights[k] / totalWeight;
  }
  return { playerId, name: player.name, combos: combos.filter((c) => c.weight > 0.001), preflopLine: line, preflopText, buckets, bucketWeights, totalWeight, explanation };
}
