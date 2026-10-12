/**
 * No-limit Texas Hold'em table state machine. Pure functions: every transition returns a new state.
 * No UI code and no knowledge of bots/coach lives here.
 */
import { Card, Rng, newDeck, hasDuplicates } from './cards';
import { evaluate, HandValue, handNameHe } from './evaluator';
import { calculatePots, splitPot, Pot } from './pots';

export type Street = 'preflop' | 'flop' | 'turn' | 'river' | 'showdown';
export const STREETS: Street[] = ['preflop', 'flop', 'turn', 'river'];
export type ActionType = 'fold' | 'check' | 'call' | 'bet' | 'raise';
export type Position = 'BTN' | 'SB' | 'BB' | 'UTG' | 'MP' | 'HJ' | 'CO';

export interface PlayerAction {
  type: ActionType;
  /** For bet/raise: the total amount this player's street bet becomes ("raise to"). */
  amount?: number;
}

export interface LastAction {
  type: ActionType | 'post';
  amount: number;
  street: Street;
  allIn: boolean;
}

export interface Player {
  id: string;
  name: string;
  isHero: boolean;
  /** Bot style id; undefined for the hero. */
  profile?: string;
  stack: number;
  hole: Card[];
  folded: boolean;
  allIn: boolean;
  streetBet: number;
  totalBet: number;
  hasActed: boolean;
  /** Value of fullRaiseCount when this player last acted (used for re-raise rights). */
  actedAtRaise: number;
  lastAction?: LastAction;
}

export interface LogEntry {
  street: Street;
  playerId: string;
  action: ActionType | 'post-sb' | 'post-bb' | 'return';
  /** Chips moved into the pot by this action (negative for returned uncalled bets). */
  chips: number;
  /** The player's street bet after the action. */
  to: number;
  potAfter: number;
  allIn: boolean;
}

export interface TableConfig {
  smallBlind: number;
  bigBlind: number;
  startingStack: number;
}

export interface PotResult {
  amount: number;
  eligible: string[];
  winners: string[];
  /** Hebrew/English description of the winning hand when there was a showdown. */
  winningHand?: string;
}

export interface HandResult {
  showdown: boolean;
  pots: PotResult[];
  payouts: Record<string, number>;
  /** Hands revealed at showdown. */
  revealed: Record<string, HandValue>;
  /** Net chips won/lost this hand per player. */
  net: Record<string, number>;
}

export interface GameState {
  handNumber: number;
  config: TableConfig;
  players: Player[];
  buttonIndex: number;
  street: Street;
  board: Card[];
  deck: Card[];
  currentBet: number;
  lastRaiseSize: number;
  fullRaiseCount: number;
  /** Index of the player to act, or -1 when no action is pending. */
  toAct: number;
  log: LogEntry[];
  /** Pot size at the start of each street (before any action on it). */
  potAtStreet: Partial<Record<Street, number>>;
  startStacks: Record<string, number>;
  preflopAggressorId?: string;
  /** Last player to bet/raise on the current street. */
  streetAggressorId?: string;
  result?: HandResult;
  /** Players who were re-bought before this hand (for stats). */
  rebuys: string[];
}

export interface LegalActions {
  canFold: boolean;
  canCheck: boolean;
  canCall: boolean;
  callAmount: number;
  canBet: boolean;
  canRaise: boolean;
  /** Min/max "to" amounts for a bet or raise. */
  minTo: number;
  maxTo: number;
  /** True if calling puts the player all-in. */
  callIsAllIn: boolean;
}

export interface SeatSetup {
  id: string;
  name: string;
  isHero: boolean;
  profile?: string;
}

// ---------------------------------------------------------------- helpers

const clone = <T>(x: T): T => structuredClone(x);

export const potSize = (s: GameState): number => s.players.reduce((sum, p) => sum + p.totalBet, 0);

export const inHand = (p: Player): boolean => !p.folded;
export const canStillAct = (p: Player): boolean => !p.folded && !p.allIn;

function nextIndex(s: GameState, from: number, pred: (p: Player) => boolean): number {
  const n = s.players.length;
  for (let i = 1; i <= n; i++) {
    const idx = (from + i) % n;
    if (pred(s.players[idx])) return idx;
  }
  return -1;
}

export function blindIndices(s: Pick<GameState, 'players' | 'buttonIndex'>): { sb: number; bb: number } {
  const n = s.players.length;
  if (n === 2) return { sb: s.buttonIndex, bb: (s.buttonIndex + 1) % n };
  return { sb: (s.buttonIndex + 1) % n, bb: (s.buttonIndex + 2) % n };
}

const POSITION_ORDER: Record<number, Position[]> = {
  2: ['BTN', 'BB'],
  3: ['BTN', 'SB', 'BB'],
  4: ['BTN', 'SB', 'BB', 'CO'],
  5: ['BTN', 'SB', 'BB', 'UTG', 'CO'],
  6: ['BTN', 'SB', 'BB', 'UTG', 'HJ', 'CO'],
  7: ['BTN', 'SB', 'BB', 'UTG', 'MP', 'HJ', 'CO'],
};

export function positionOf(s: Pick<GameState, 'players' | 'buttonIndex'>, playerIndex: number): Position {
  const n = s.players.length;
  const offset = (playerIndex - s.buttonIndex + n) % n;
  return POSITION_ORDER[n]?.[offset] ?? 'UTG';
}

export function playerIndex(s: GameState, id: string): number {
  return s.players.findIndex((p) => p.id === id);
}

// ---------------------------------------------------------------- setup

export function createTable(seats: SeatSetup[], config: TableConfig): GameState {
  if (seats.length < 2) throw new Error('Need at least 2 players');
  return {
    handNumber: 0,
    config,
    players: seats.map((s) => ({
      ...s,
      stack: config.startingStack,
      hole: [],
      folded: false,
      allIn: false,
      streetBet: 0,
      totalBet: 0,
      hasActed: false,
      actedAtRaise: 0,
    })),
    // Starts at the last seat so the first hand puts the button on seat 0.
    buttonIndex: seats.length - 1,
    street: 'showdown',
    board: [],
    deck: [],
    currentBet: 0,
    lastRaiseSize: config.bigBlind,
    fullRaiseCount: 0,
    toAct: -1,
    log: [],
    potAtStreet: {},
    startStacks: {},
    rebuys: [],
  };
}

export interface StartOptions {
  /** Force specific hole cards for a player (used by adaptive training). Cards must be unique. */
  forcedHole?: Record<string, Card[]>;
}

function putChips(p: Player, amount: number): number {
  const a = Math.min(amount, p.stack);
  p.stack -= a;
  p.streetBet += a;
  p.totalBet += a;
  if (p.stack === 0) p.allIn = true;
  return a;
}

/** Starts a new hand: moves the button, re-buys busted players, posts blinds and deals. */
export function startHand(prev: GameState, rng: Rng, opts: StartOptions = {}): GameState {
  const s = clone(prev);
  s.handNumber += 1;
  s.rebuys = [];
  for (const p of s.players) {
    if (p.stack < s.config.bigBlind) {
      p.stack = s.config.startingStack;
      s.rebuys.push(p.id);
    }
    Object.assign(p, { hole: [], folded: false, allIn: false, streetBet: 0, totalBet: 0, hasActed: false, actedAtRaise: 0, lastAction: undefined });
  }
  s.buttonIndex = (s.buttonIndex + 1) % s.players.length;
  s.street = 'preflop';
  s.board = [];
  s.log = [];
  s.result = undefined;
  s.preflopAggressorId = undefined;
  s.streetAggressorId = undefined;
  s.startStacks = Object.fromEntries(s.players.map((p) => [p.id, p.stack]));

  // Deal: forced hole cards first, then a shuffled deck without them.
  const forced = opts.forcedHole ?? {};
  const forcedCards = Object.values(forced).flat();
  if (hasDuplicates(forcedCards)) throw new Error('Forced hole cards contain duplicates');
  s.deck = newDeck(rng, forcedCards);
  const n = s.players.length;
  for (let round = 0; round < 2; round++) {
    for (let i = 1; i <= n; i++) {
      const p = s.players[(s.buttonIndex + i) % n];
      if (forced[p.id]) continue;
      p.hole.push(s.deck.pop()!);
    }
  }
  for (const p of s.players) if (forced[p.id]) p.hole = [...forced[p.id]];

  // Blinds
  const { sb, bb } = blindIndices(s);
  const sbP = s.players[sb];
  const bbP = s.players[bb];
  const sbAmt = putChips(sbP, s.config.smallBlind);
  s.log.push({ street: 'preflop', playerId: sbP.id, action: 'post-sb', chips: sbAmt, to: sbP.streetBet, potAfter: potSize(s), allIn: sbP.allIn });
  sbP.lastAction = { type: 'post', amount: sbAmt, street: 'preflop', allIn: sbP.allIn };
  const bbAmt = putChips(bbP, s.config.bigBlind);
  s.log.push({ street: 'preflop', playerId: bbP.id, action: 'post-bb', chips: bbAmt, to: bbP.streetBet, potAfter: potSize(s), allIn: bbP.allIn });
  bbP.lastAction = { type: 'post', amount: bbAmt, street: 'preflop', allIn: bbP.allIn };

  s.currentBet = s.config.bigBlind;
  s.lastRaiseSize = s.config.bigBlind;
  s.fullRaiseCount = 0;
  s.potAtStreet = { preflop: 0 };
  s.toAct = nextIndex(s, bb, canStillAct);
  if (isRoundComplete(s)) return endStreet(s);
  return s;
}

// ---------------------------------------------------------------- actions

export function getLegalActions(s: GameState): LegalActions | null {
  if (s.toAct < 0 || s.street === 'showdown') return null;
  const p = s.players[s.toAct];
  const owed = Math.max(0, s.currentBet - p.streetBet);
  const callAmount = Math.min(owed, p.stack);
  const maxTo = p.streetBet + p.stack;
  const othersCanAct = s.players.some((o) => o !== p && canStillAct(o));
  const hasRaiseRights = !p.hasActed || p.actedAtRaise < s.fullRaiseCount;
  const canCheck = owed === 0;
  const canBet = s.currentBet === 0 && p.stack > 0 && othersCanAct;
  const canRaise = s.currentBet > 0 && maxTo > s.currentBet && hasRaiseRights && othersCanAct;
  const minTo = s.currentBet === 0
    ? Math.min(s.config.bigBlind, maxTo)
    : Math.min(s.currentBet + s.lastRaiseSize, maxTo);
  return {
    canFold: true,
    canCheck,
    canCall: owed > 0,
    callAmount,
    canBet,
    canRaise,
    minTo,
    maxTo,
    callIsAllIn: owed > 0 && callAmount === p.stack,
  };
}

export class IllegalActionError extends Error {}

/** Applies the action of the player to act and advances the game as needed. */
export function applyAction(prev: GameState, action: PlayerAction): GameState {
  const legal = getLegalActions(prev);
  if (!legal) throw new IllegalActionError('No player to act');
  const s = clone(prev);
  const p = s.players[s.toAct];
  let chips = 0;

  switch (action.type) {
    case 'fold':
      p.folded = true;
      break;
    case 'check':
      if (!legal.canCheck) throw new IllegalActionError('Cannot check facing a bet');
      break;
    case 'call':
      if (!legal.canCall) throw new IllegalActionError('Nothing to call');
      chips = putChips(p, legal.callAmount);
      break;
    case 'bet':
    case 'raise': {
      if (action.type === 'bet' && !legal.canBet) throw new IllegalActionError('Cannot bet');
      if (action.type === 'raise' && !legal.canRaise) throw new IllegalActionError('Cannot raise');
      const to = Math.floor(action.amount ?? legal.minTo);
      if (to > legal.maxTo) throw new IllegalActionError(`Amount ${to} exceeds stack (max ${legal.maxTo})`);
      if (to < legal.minTo) throw new IllegalActionError(`Minimum is ${legal.minTo}`);
      const raiseSize = to - s.currentBet;
      chips = putChips(p, to - p.streetBet);
      if (raiseSize >= s.lastRaiseSize) {
        s.lastRaiseSize = raiseSize;
        s.fullRaiseCount += 1;
      }
      s.currentBet = Math.max(s.currentBet, to);
      s.streetAggressorId = p.id;
      if (s.street === 'preflop') s.preflopAggressorId = p.id;
      break;
    }
    default:
      throw new IllegalActionError(`Unknown action ${(action as PlayerAction).type}`);
  }

  p.hasActed = true;
  p.actedAtRaise = s.fullRaiseCount;
  p.lastAction = { type: action.type, amount: p.streetBet, street: s.street, allIn: p.allIn };
  s.log.push({ street: s.street, playerId: p.id, action: action.type, chips, to: p.streetBet, potAfter: potSize(s), allIn: p.allIn });

  const remaining = s.players.filter(inHand);
  if (remaining.length === 1) {
    returnUncalled(s);
    return awardWithoutShowdown(s, remaining[0]);
  }
  if (isRoundComplete(s)) return endStreet(s);
  s.toAct = nextIndex(s, s.toAct, canStillAct);
  return s;
}

function isRoundComplete(s: GameState): boolean {
  const active = s.players.filter(canStillAct);
  if (active.length === 0) return true;
  // Everyone else is all-in or folded: done once the last player has matched the bet.
  if (active.length === 1) return active[0].streetBet >= s.currentBet;
  return active.every((p) => p.hasActed && p.streetBet === s.currentBet);
}

/** Gives back the part of the highest bet nobody matched. */
function returnUncalled(s: GameState): void {
  const sorted = [...s.players].sort((a, b) => b.streetBet - a.streetBet);
  const [top, second] = sorted;
  if (!top || top.streetBet === 0) return;
  const diff = top.streetBet - (second?.streetBet ?? 0);
  if (diff > 0) {
    top.streetBet -= diff;
    top.totalBet -= diff;
    top.stack += diff;
    if (top.stack > 0) top.allIn = false;
    s.log.push({ street: s.street, playerId: top.id, action: 'return', chips: -diff, to: top.streetBet, potAfter: potSize(s), allIn: false });
  }
}

const CARDS_FOR: Record<Street, number> = { preflop: 0, flop: 3, turn: 1, river: 1, showdown: 0 };

function dealStreet(s: GameState, street: Street): void {
  s.deck.pop(); // burn
  for (let i = 0; i < CARDS_FOR[street]; i++) s.board.push(s.deck.pop()!);
}

function endStreet(s: GameState): GameState {
  returnUncalled(s);
  for (const p of s.players) {
    p.streetBet = 0;
    p.hasActed = false;
    p.actedAtRaise = 0;
  }
  s.currentBet = 0;
  s.lastRaiseSize = s.config.bigBlind;
  s.fullRaiseCount = 0;
  s.streetAggressorId = undefined;

  const order: Street[] = ['preflop', 'flop', 'turn', 'river', 'showdown'];
  const next = order[order.indexOf(s.street) + 1];
  if (next === 'showdown') return showdown(s);

  s.street = next;
  dealStreet(s, next);
  s.potAtStreet[next] = potSize(s);

  // If at most one player can still bet, run the board out.
  if (s.players.filter(canStillAct).length <= 1) {
    s.toAct = -1;
    return endStreet(s);
  }
  s.toAct = nextIndex(s, s.buttonIndex, canStillAct);
  return s;
}

function orderFromButton(s: GameState, ids: string[]): string[] {
  const n = s.players.length;
  const out: string[] = [];
  for (let i = 1; i <= n; i++) {
    const p = s.players[(s.buttonIndex + i) % n];
    if (ids.includes(p.id)) out.push(p.id);
  }
  return out;
}

function finish(s: GameState, result: Omit<HandResult, 'net'>): GameState {
  for (const [id, amt] of Object.entries(result.payouts)) {
    s.players.find((p) => p.id === id)!.stack += amt;
  }
  const net = Object.fromEntries(s.players.map((p) => [p.id, p.stack - s.startStacks[p.id]]));
  s.result = { ...result, net };
  s.street = 'showdown';
  s.toAct = -1;
  return s;
}

function awardWithoutShowdown(s: GameState, winner: Player): GameState {
  const amount = potSize(s);
  return finish(s, {
    showdown: false,
    pots: [{ amount, eligible: [winner.id], winners: [winner.id] }],
    payouts: { [winner.id]: amount },
    revealed: {},
  });
}

function showdown(s: GameState): GameState {
  const contenders = s.players.filter(inHand);
  const revealed: Record<string, HandValue> = {};
  for (const p of contenders) revealed[p.id] = evaluate([...p.hole, ...s.board]);

  const pots: Pot[] = calculatePots(s.players.map((p) => ({ playerId: p.id, amount: p.totalBet, folded: p.folded })));
  const payouts: Record<string, number> = {};
  const potResults: PotResult[] = pots.map((pot) => {
    const best = Math.max(...pot.eligible.map((id) => revealed[id].score));
    const winners = orderFromButton(s, pot.eligible.filter((id) => revealed[id].score === best));
    for (const [id, amt] of Object.entries(splitPot(pot.amount, winners))) payouts[id] = (payouts[id] ?? 0) + amt;
    return { ...pot, winners, winningHand: handNameHe(revealed[winners[0]]) };
  });
  return finish(s, { showdown: true, pots: potResults, payouts, revealed });
}

export const isHandOver = (s: GameState): boolean => !!s.result;

// ---------------------------------------------------------------- views

export interface PublicPlayer {
  id: string;
  name: string;
  isHero: boolean;
  profile?: string;
  stack: number;
  streetBet: number;
  totalBet: number;
  folded: boolean;
  allIn: boolean;
  position: Position;
  lastAction?: LastAction;
}

/**
 * Everything a player at the table may legitimately know: public information plus
 * their own hole cards. Bots and the coach only ever receive this.
 */
export interface PlayerView {
  handNumber: number;
  myId: string;
  myIndex: number;
  myHole: Card[];
  myPosition: Position;
  street: Street;
  board: Card[];
  players: PublicPlayer[];
  buttonIndex: number;
  currentBet: number;
  pot: number;
  toCall: number;
  config: TableConfig;
  log: LogEntry[];
  potAtStreet: Partial<Record<Street, number>>;
  preflopAggressorId?: string;
  streetAggressorId?: string;
  legal: LegalActions | null;
}

export function getPlayerView(s: GameState, id: string): PlayerView {
  const idx = playerIndex(s, id);
  if (idx < 0) throw new Error(`Unknown player ${id}`);
  const me = s.players[idx];
  return {
    handNumber: s.handNumber,
    myId: id,
    myIndex: idx,
    myHole: [...me.hole],
    myPosition: positionOf(s, idx),
    street: s.street,
    board: [...s.board],
    players: s.players.map((p, i) => ({
      id: p.id,
      name: p.name,
      isHero: p.isHero,
      profile: p.profile,
      stack: p.stack,
      streetBet: p.streetBet,
      totalBet: p.totalBet,
      folded: p.folded,
      allIn: p.allIn,
      position: positionOf(s, i),
      lastAction: p.lastAction ? { ...p.lastAction } : undefined,
    })),
    buttonIndex: s.buttonIndex,
    currentBet: s.currentBet,
    pot: potSize(s),
    toCall: Math.max(0, Math.min(s.currentBet - me.streetBet, me.stack)),
    config: { ...s.config },
    log: s.log.map((l) => ({ ...l })),
    potAtStreet: { ...s.potAtStreet },
    preflopAggressorId: s.preflopAggressorId,
    streetAggressorId: s.streetAggressorId,
    legal: s.toAct === idx ? getLegalActions(s) : null,
  };
}

/** Total chips on the table (stacks + pot); constant within a hand. After payout the pot is in the stacks. */
export const totalChips = (s: GameState): number =>
  s.players.reduce((sum, p) => sum + p.stack + (s.result ? 0 : p.totalBet), 0);
