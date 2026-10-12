/**
 * Adaptive dealing: occasionally deals the hero a hand that leads to situations in the
 * player's weakest topic. The deck stays a real 52-card deck — only the hero's two cards
 * are chosen first, everything else is shuffled from the remaining cards.
 */
import { Card, Rng } from '../engine/cards';
import { allClasses, combosOf, preflopPercentile, isSuited, isPair, gapOf, HandClass } from '../engine/handClasses';
import { Topic } from '../coach/types';
import { Stats, weakestTopics } from './stats';

const POOLS: Partial<Record<Topic, (cls: HandClass) => boolean>> = {
  // Suited and connected hands flop draws → outs / pot odds / draws practice.
  draws: (c) => isSuited(c) && gapOf(c) <= 2,
  outs: (c) => isSuited(c) && gapOf(c) <= 2,
  potOdds: (c) => (isSuited(c) && gapOf(c) <= 3) || (isPair(c) && preflopPercentile(c) > 0.03),
  // Borderline hands are where position decides the right play.
  position: (c) => preflopPercentile(c) > 0.12 && preflopPercentile(c) < 0.45,
  preflop: (c) => preflopPercentile(c) > 0.08 && preflopPercentile(c) < 0.5,
  // Strong-ish hands make value/bluff and sizing decisions.
  valueBluff: (c) => preflopPercentile(c) < 0.2,
  betSizing: (c) => preflopPercentile(c) < 0.2,
  ranges: (c) => preflopPercentile(c) < 0.3,
  handReading: (c) => preflopPercentile(c) < 0.4,
  boardTexture: (c) => preflopPercentile(c) < 0.4,
};

export interface AdaptiveDeal {
  topic: Topic;
  hole: Card[];
}

export function adaptiveHole(stats: Stats, rng: Rng, chance = 0.35): AdaptiveDeal | null {
  const weak = weakestTopics(stats, 4);
  const topic = weak.find((t) => POOLS[t]);
  if (!topic || rng() > chance) return null;
  const pool = allClasses().filter(POOLS[topic]!);
  if (!pool.length) return null;
  const cls = pool[Math.floor(rng() * pool.length)];
  const combos = combosOf(cls);
  return { topic, hole: combos[Math.floor(rng() * combos.length)] };
}
