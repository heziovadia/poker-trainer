/** Hand history records built from a finished GameState. */
import { Card } from '../engine/cards';
import { GameState, Street, STREETS, positionOf } from '../engine/game';
import { DecisionAnalysis, Level } from '../coach/types';
import { handNameHe } from '../engine/evaluator';

export interface HistoryAction {
  name: string;
  isHero: boolean;
  action: string;
  amount: number;
  allIn: boolean;
}

export interface HistoryStreet {
  street: Street;
  potStart: number;
  board: Card[];
  actions: HistoryAction[];
}

export interface HandRecord {
  id: string;
  handNumber: number;
  timestamp: number;
  level: Level;
  heroHole: Card[];
  heroPosition: string;
  board: Card[];
  streets: HistoryStreet[];
  players: { id: string; name: string; position: string; profile?: string; shownHole?: Card[]; handName?: string }[];
  winners: string[];
  winningHand?: string;
  potTotal: number;
  heroNet: number;
  showdown: boolean;
  decisions: DecisionAnalysis[];
  starred: boolean;
}

const BOARD_LEN: Record<Street, number> = { preflop: 0, flop: 3, turn: 4, river: 5, showdown: 5 };

const ACTION_HE: Record<string, string> = {
  'post-sb': 'Small Blind', 'post-bb': 'Big Blind', fold: 'Fold', check: 'Check', call: 'Call', bet: 'Bet', raise: 'Raise', return: 'קיבל בחזרה',
};

export function buildHandRecord(s: GameState, heroId: string, level: Level, decisions: DecisionAnalysis[]): HandRecord {
  const r = s.result!;
  const name = (id: string) => s.players.find((p) => p.id === id)?.name ?? id;
  const streets: HistoryStreet[] = STREETS.filter((st) => s.potAtStreet[st] !== undefined).map((st) => ({
    street: st,
    potStart: s.potAtStreet[st] ?? 0,
    board: s.board.slice(0, BOARD_LEN[st]),
    actions: s.log.filter((l) => l.street === st).map((l) => ({
      name: name(l.playerId),
      isHero: l.playerId === heroId,
      action: ACTION_HE[l.action] ?? l.action,
      amount: l.action === 'bet' || l.action === 'raise' ? l.to : Math.abs(l.chips),
      allIn: l.allIn,
    })),
  }));
  const heroIdx = s.players.findIndex((p) => p.id === heroId);
  const allWinners = [...new Set(r.pots.flatMap((p) => p.winners))];
  return {
    id: `${Date.now()}-${s.handNumber}`,
    handNumber: s.handNumber,
    timestamp: Date.now(),
    level,
    heroHole: [...s.players[heroIdx].hole],
    heroPosition: positionOf(s, heroIdx),
    board: [...s.board],
    streets,
    players: s.players.map((p, i) => ({
      id: p.id,
      name: p.name,
      position: positionOf(s, i),
      profile: p.profile,
      shownHole: r.showdown && r.revealed[p.id] ? [...p.hole] : p.id === heroId ? [...p.hole] : undefined,
      handName: r.revealed[p.id] ? handNameHe(r.revealed[p.id]) : undefined,
    })),
    winners: allWinners.map(name),
    winningHand: r.pots[0]?.winningHand,
    potTotal: r.pots.reduce((a, p) => a + p.amount, 0),
    heroNet: r.net[heroId] ?? 0,
    showdown: r.showdown,
    decisions,
    starred: false,
  };
}
