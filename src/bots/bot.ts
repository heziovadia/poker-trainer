/**
 * Opponent decision making. A bot receives only a PlayerView (public table state + its own
 * hole cards) — it can never see the hero's cards.
 */
import { Rng } from '../engine/cards';
import { PlayerView, PlayerAction, Street } from '../engine/game';
import { classOf, preflopPercentile } from '../engine/handClasses';
import { equity } from '../engine/equity';
import { findDraws } from '../engine/boardAnalysis';
import { profileOf, OPEN_RANGE, BotProfile } from './profiles';

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

function raisesOn(view: PlayerView, street: Street): number {
  return view.log.filter((l) => l.street === street && (l.action === 'raise' || l.action === 'bet')).length;
}

function limpers(view: PlayerView): number {
  return view.log.filter((l) => l.street === 'preflop' && l.action === 'call').length;
}

function toAction(view: PlayerView, kind: 'aggr' | 'call' | 'passive', to?: number): PlayerAction {
  const l = view.legal!;
  if (kind === 'aggr' && (l.canBet || l.canRaise)) {
    const amount = Math.round(clamp(to ?? l.minTo, l.minTo, l.maxTo));
    // Close to all-in? Just shove.
    const finalAmt = l.maxTo - amount < view.config.bigBlind * 3 ? l.maxTo : amount;
    return { type: l.canBet ? 'bet' : 'raise', amount: finalAmt };
  }
  if (kind === 'aggr' || kind === 'call') {
    if (l.canCheck) return { type: 'check' };
    return { type: 'call' };
  }
  return l.canCheck ? { type: 'check' } : { type: 'fold' };
}

function preflopDecision(view: PlayerView, p: BotProfile, rng: Rng): PlayerAction {
  const bb = view.config.bigBlind;
  const pct = preflopPercentile(classOf(view.myHole));
  const raises = raisesOn(view, 'preflop');
  const pos = view.myPosition;
  const noise = (rng() - 0.5) * 0.04;

  if (raises === 0) {
    const nLimp = limpers(view);
    if (pos === 'BB' && view.toCall === 0) {
      return pct <= 0.1 * p.openWidth + noise ? toAction(view, 'aggr', bb * (3 + nLimp)) : toAction(view, 'passive');
    }
    const width = clamp((OPEN_RANGE[pos] ?? 0.2) * p.openWidth * (nLimp ? 0.8 : 1), 0.04, 0.85) + noise;
    if (pct <= width) {
      if (rng() < p.limpFreq && pct > 0.06) return toAction(view, 'call');
      return toAction(view, 'aggr', Math.round(bb * (2.5 + nLimp)));
    }
    // Cheap SB completion or loose limp behind.
    if (nLimp > 0 && pct <= width * 1.4 && rng() < p.limpFreq) return toAction(view, 'call');
    return toAction(view, 'passive');
  }

  if (raises === 1) {
    const threeBet = p.threeBet + noise / 2;
    let callW = p.threeBet + p.callRaise + noise;
    if (pos === 'BB') callW += 0.12; // good price
    if (pct <= threeBet) return toAction(view, 'aggr', view.currentBet * (pos === 'BB' || pos === 'SB' ? 3.8 : 3));
    // Light 3-bet bluffs from aggressive players with suited hands.
    if (pct > 0.3 && pct < 0.5 && view.myHole[0] % 4 === view.myHole[1] % 4 && rng() < p.bluff * 0.25) {
      return toAction(view, 'aggr', view.currentBet * 3);
    }
    const priceOk = view.toCall <= Math.max(view.config.startingStack * 0.12, bb * 6);
    if (pct <= callW && priceOk) return toAction(view, 'call');
    return toAction(view, 'passive');
  }

  // Facing a 3-bet or more.
  if (pct <= 0.025 + p.aggression * 0.01) return toAction(view, 'aggr', view.currentBet * 2.3);
  if (pct <= 0.06 + p.stickiness * 0.3) return toAction(view, 'call');
  return toAction(view, 'passive');
}

function postflopDecision(view: PlayerView, p: BotProfile, rng: Rng): PlayerAction {
  const opponents = view.players.filter((x) => !x.folded && x.id !== view.myId).length;
  const eq = equity({
    hero: view.myHole,
    board: view.board,
    opponents: Array.from({ length: opponents }, () => null),
    iterations: 300,
    rng,
  }).equity;
  const draws = view.street === 'river' ? [] : findDraws(view.myHole, view.board);
  const strongDraw = draws.some((d) => d.outs >= 8);
  const pot = view.pot;
  const raises = raisesOn(view, view.street);
  // Random-hand equity overstates strength against players who bet; tighten as aggression grows.
  const adj = eq - raises * 0.12 - (opponents - 1) * 0.03;

  if (view.toCall === 0) {
    if (adj >= 0.62 - p.aggression * 0.08 && rng() < 0.35 + p.aggression * 0.6) {
      return toAction(view, 'aggr', pot * (0.5 + rng() * 0.3));
    }
    if (strongDraw && rng() < p.aggression * 0.6) return toAction(view, 'aggr', pot * 0.55);
    const isAggressor = view.preflopAggressorId === view.myId;
    if (adj < 0.4 && opponents <= 2 && rng() < p.bluff * (isAggressor && view.street === 'flop' ? 2.2 : 1)) {
      return toAction(view, 'aggr', pot * (0.33 + rng() * 0.25));
    }
    return toAction(view, 'passive');
  }

  const odds = view.toCall / (pot + view.toCall);
  if (adj >= 0.78 - p.aggression * 0.08 && rng() < 0.3 + p.aggression * 0.6) {
    return toAction(view, 'aggr', view.currentBet * 2.8 + pot * 0.2);
  }
  if (strongDraw && raises === 1 && rng() < p.aggression * 0.2) return toAction(view, 'aggr', view.currentBet * 3);
  const drawBonus = strongDraw ? 0.08 : 0;
  if (adj + drawBonus + p.stickiness >= odds + 0.04) return toAction(view, 'call');
  if (adj < 0.25 && raises === 1 && opponents === 1 && rng() < p.bluff * 0.25) {
    return toAction(view, 'aggr', view.currentBet * 3);
  }
  return toAction(view, 'passive');
}

export function decideBotAction(view: PlayerView, profileId: string | undefined, rng: Rng): PlayerAction {
  if (!view.legal) throw new Error('Bot asked to act out of turn');
  const p = profileOf(profileId);
  return view.street === 'preflop' ? preflopDecision(view, p, rng) : postflopDecision(view, p, rng);
}
