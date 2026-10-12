/** Pot and side-pot calculation, independent of the table state machine. */

export interface Contribution {
  playerId: string;
  /** Total chips put in during the whole hand. */
  amount: number;
  folded: boolean;
}

export interface Pot {
  amount: number;
  /** Players who can win this pot (not folded, contributed enough). */
  eligible: string[];
}

/**
 * Splits contributions into a main pot and side pots.
 * Each layer is bounded by an all-in level of a player still in the hand; folded chips
 * stay in the layers they reached but those players are never eligible.
 */
export function calculatePots(contribs: Contribution[]): Pot[] {
  const live = contribs.filter((c) => !c.folded && c.amount > 0);
  const levels = [...new Set(live.map((c) => c.amount))].sort((a, b) => a - b);
  const pots: Pot[] = [];
  let prev = 0;
  for (const level of levels) {
    let amount = 0;
    for (const c of contribs) amount += Math.max(0, Math.min(c.amount, level) - Math.min(c.amount, prev));
    const eligible = live.filter((c) => c.amount >= level).map((c) => c.playerId);
    if (amount > 0) {
      // Merge with previous pot if eligibility is identical (keeps the display simple).
      const last = pots[pots.length - 1];
      if (last && last.eligible.length === eligible.length && last.eligible.every((id) => eligible.includes(id))) {
        last.amount += amount;
      } else {
        pots.push({ amount, eligible });
      }
    }
    prev = level;
  }
  // Chips above the highest live level (should not happen after uncalled bets are returned).
  let leftover = 0;
  for (const c of contribs) leftover += Math.max(0, c.amount - prev);
  if (leftover > 0) {
    if (pots.length) pots[pots.length - 1].amount += leftover;
    else pots.push({ amount: leftover, eligible: live.map((c) => c.playerId) });
  }
  return pots;
}

export const totalPot = (contribs: Contribution[]): number => contribs.reduce((s, c) => s + c.amount, 0);

/**
 * Splits one pot between winners. Odd chips go to winners in the given order
 * (the caller passes them ordered from the first seat left of the button).
 */
export function splitPot(amount: number, winnersInOrder: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  if (!winnersInOrder.length) return out;
  const share = Math.floor(amount / winnersInOrder.length);
  let rem = amount - share * winnersInOrder.length;
  for (const id of winnersInOrder) {
    out[id] = share + (rem > 0 ? 1 : 0);
    if (rem > 0) rem--;
  }
  return out;
}

/** Pot odds: share of the final pot that the call represents. */
export function potOdds(toCall: number, potBeforeCall: number): number {
  if (toCall <= 0) return 0;
  return toCall / (potBeforeCall + toCall);
}
