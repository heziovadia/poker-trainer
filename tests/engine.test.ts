import { describe, it, expect } from 'vitest';
import { fullDeck, newDeck, seededRng, parseCards, hasDuplicates, cardToString, parseCard } from '../src/engine/cards';
import { calculatePots, splitPot, potOdds } from '../src/engine/pots';
import {
  createTable, startHand, applyAction, getLegalActions, GameState, totalChips, positionOf,
  IllegalActionError, getPlayerView, potSize, SeatSetup,
} from '../src/engine/game';
import { calculateOuts, findDraws, describeMadeHand, analyzeBoard } from '../src/engine/boardAnalysis';
import { HandCategory } from '../src/engine/evaluator';
import { relativeStrength, equity } from '../src/engine/equity';
import { classOf, combosOf, allClasses, comboCount, preflopPercentile, topRange } from '../src/engine/handClasses';

describe('deck', () => {
  it('has 52 unique cards', () => {
    const d = fullDeck();
    expect(d).toHaveLength(52);
    expect(new Set(d).size).toBe(52);
    expect(new Set(d.map(cardToString)).size).toBe(52);
  });
  it('shuffled deck keeps all 52 cards exactly once', () => {
    const rng = seededRng(1);
    for (let i = 0; i < 200; i++) {
      const d = newDeck(rng);
      expect(d).toHaveLength(52);
      expect(hasDuplicates(d)).toBe(false);
    }
  });
  it('excluded cards are removed', () => {
    const ex = parseCards('As Kd');
    const d = newDeck(seededRng(3), ex);
    expect(d).toHaveLength(50);
    ex.forEach((c) => expect(d).not.toContain(c));
  });
  it('parse round-trips', () => {
    for (const c of fullDeck()) expect(parseCard(cardToString(c))).toBe(c);
  });
  it('shuffle is roughly uniform (first card position)', () => {
    const rng = seededRng(9);
    const counts = new Array(52).fill(0);
    for (let i = 0; i < 52000; i++) counts[newDeck(rng)[0]]++;
    counts.forEach((n) => expect(n).toBeGreaterThan(800));
  });
});

describe('pots and side pots', () => {
  it('single pot when everyone contributes equally', () => {
    const pots = calculatePots([
      { playerId: 'a', amount: 100, folded: false },
      { playerId: 'b', amount: 100, folded: false },
      { playerId: 'c', amount: 100, folded: true },
    ]);
    expect(pots).toEqual([{ amount: 300, eligible: ['a', 'b'] }]);
  });
  it('builds a side pot for a short all-in', () => {
    const pots = calculatePots([
      { playerId: 'short', amount: 50, folded: false },
      { playerId: 'b', amount: 200, folded: false },
      { playerId: 'c', amount: 200, folded: false },
    ]);
    expect(pots).toEqual([
      { amount: 150, eligible: ['short', 'b', 'c'] },
      { amount: 300, eligible: ['b', 'c'] },
    ]);
  });
  it('three different all-in levels plus a folded contributor', () => {
    const contribs = [
      { playerId: 'a', amount: 30, folded: false },
      { playerId: 'b', amount: 80, folded: false },
      { playerId: 'c', amount: 150, folded: false },
      { playerId: 'd', amount: 150, folded: false },
      { playerId: 'e', amount: 60, folded: true },
    ];
    const pots = calculatePots(contribs);
    expect(pots.map((p) => p.amount)).toEqual([150, 180, 140]);
    expect(pots[0].eligible).toEqual(['a', 'b', 'c', 'd']);
    expect(pots[1].eligible).toEqual(['b', 'c', 'd']);
    expect(pots[2].eligible).toEqual(['c', 'd']);
    expect(pots.reduce((s, p) => s + p.amount, 0)).toBe(470);
  });
  it('split pot gives odd chip to first winner', () => {
    expect(splitPot(101, ['x', 'y'])).toEqual({ x: 51, y: 50 });
    expect(splitPot(90, ['x', 'y', 'z'])).toEqual({ x: 30, y: 30, z: 30 });
  });
});

describe('pot odds', () => {
  it('20 to call into 60 → 25%', () => expect(potOdds(20, 60)).toBeCloseTo(0.25));
  it('half-pot bet needs 25%: pot 100 + bet 50, call 50 → 50/200', () => expect(potOdds(50, 150)).toBeCloseTo(0.25));
  it('pot-sized bet needs 33%', () => expect(potOdds(100, 200)).toBeCloseTo(1 / 3));
  it('nothing to call → 0', () => expect(potOdds(0, 100)).toBe(0));
});

// ---------------------------------------------------------------- game

const SEATS: SeatSetup[] = ['hero', 'b1', 'b2', 'b3', 'b4', 'b5'].map((id, i) => ({ id, name: id, isHero: i === 0 }));
const CONFIG = { smallBlind: 1, bigBlind: 2, startingStack: 200 };

function freshHand(seed = 1): GameState {
  return startHand(createTable(SEATS, CONFIG), seededRng(seed));
}

describe('dealing and blinds', () => {
  it('deals 2 unique cards to each of 6 players', () => {
    const s = freshHand();
    const all = s.players.flatMap((p) => p.hole);
    expect(all).toHaveLength(12);
    expect(hasDuplicates([...all, ...s.deck])).toBe(false);
    expect(all.length + s.deck.length).toBe(52);
  });
  it('first hand: button on seat 0, SB seat 1, BB seat 2, UTG acts first', () => {
    const s = freshHand();
    expect(s.buttonIndex).toBe(0);
    expect(s.players[1].streetBet).toBe(1);
    expect(s.players[2].streetBet).toBe(2);
    expect(s.toAct).toBe(3);
    expect(positionOf(s, 3)).toBe('UTG');
    expect(positionOf(s, 5)).toBe('CO');
    expect(potSize(s)).toBe(3);
  });
  it('button moves every hand', () => {
    let s = freshHand();
    s = applyAll(s, () => ({ type: 'fold' }));
    const s2 = startHand(s, seededRng(2));
    expect(s2.buttonIndex).toBe(1);
  });
  it('forced hole cards are dealt and not duplicated', () => {
    const forced = parseCards('As Ah');
    const s = startHand(createTable(SEATS, CONFIG), seededRng(5), { forcedHole: { hero: forced } });
    expect(s.players[0].hole).toEqual(forced);
    const all = [...s.players.flatMap((p) => p.hole), ...s.deck];
    expect(hasDuplicates(all)).toBe(false);
    expect(all).toHaveLength(52);
  });
});

function applyAll(s: GameState, pick: (s: GameState) => { type: 'fold' | 'check' | 'call' | 'bet' | 'raise'; amount?: number }): GameState {
  let guard = 0;
  while (!s.result && guard++ < 200) s = applyAction(s, pick(s));
  return s;
}

describe('legal actions', () => {
  it('UTG facing the big blind: fold/call/raise, min raise to 4', () => {
    const s = freshHand();
    const l = getLegalActions(s)!;
    expect(l.canCheck).toBe(false);
    expect(l.canCall).toBe(true);
    expect(l.callAmount).toBe(2);
    expect(l.canRaise).toBe(true);
    expect(l.canBet).toBe(false);
    expect(l.minTo).toBe(4);
    expect(l.maxTo).toBe(200);
  });
  it('min re-raise grows with the last raise size', () => {
    let s = freshHand();
    s = applyAction(s, { type: 'raise', amount: 7 }); // raise of 5
    const l = getLegalActions(s)!;
    expect(l.minTo).toBe(12);
    expect(() => applyAction(s, { type: 'raise', amount: 10 })).toThrow(IllegalActionError);
  });
  it('BB gets the option to check when everyone limps', () => {
    let s = freshHand();
    for (let i = 0; i < 4; i++) s = applyAction(s, { type: 'call' }); // UTG, HJ, CO, BTN
    s = applyAction(s, { type: 'call' }); // SB completes
    expect(s.toAct).toBe(2);
    const l = getLegalActions(s)!;
    expect(l.canCheck).toBe(true);
    expect(l.canRaise).toBe(true);
    s = applyAction(s, { type: 'check' });
    expect(s.street).toBe('flop');
    expect(s.board).toHaveLength(3);
    expect(s.toAct).toBe(1); // SB first postflop
  });
  it('postflop: bet when no bet, check allowed; cannot check facing a bet', () => {
    let s = freshHand();
    for (let i = 0; i < 5; i++) s = applyAction(s, { type: 'call' });
    s = applyAction(s, { type: 'check' });
    let l = getLegalActions(s)!;
    expect(l.canBet).toBe(true);
    expect(l.canCheck).toBe(true);
    expect(l.minTo).toBe(2);
    s = applyAction(s, { type: 'bet', amount: 6 });
    l = getLegalActions(s)!;
    expect(l.canCheck).toBe(false);
    expect(() => applyAction(s, { type: 'check' })).toThrow(IllegalActionError);
  });
  it('cannot bet more than the stack', () => {
    const s = freshHand();
    expect(() => applyAction(s, { type: 'raise', amount: 500 })).toThrow(IllegalActionError);
  });
  it('everyone folds to BB: BB wins blinds without showdown', () => {
    let s = freshHand();
    for (let i = 0; i < 5; i++) s = applyAction(s, { type: 'fold' });
    expect(s.result).toBeDefined();
    expect(s.result!.showdown).toBe(false);
    expect(s.result!.payouts).toEqual({ b2: 2 }); // BB's uncalled 1 chip comes back first
    expect(s.players[2].stack).toBe(201);
    expect(s.players[1].stack).toBe(199);
  });
  it('uncalled bet is returned', () => {
    let s = freshHand();
    s = applyAction(s, { type: 'raise', amount: 50 }); // UTG
    for (let i = 0; i < 5; i++) s = applyAction(s, { type: 'fold' });
    expect(s.players[3].stack).toBe(203); // wins blinds only
  });
  it('incomplete all-in raise does not reopen raising for a player who already acted', () => {
    const seats = SEATS.slice(0, 3);
    let s = startHand(createTable(seats, { smallBlind: 1, bigBlind: 2, startingStack: 100 }), seededRng(4));
    // 3 players: button seat0 acts first preflop.
    s.players[2].stack = 30; // BB short: 2 posted + 30 behind → can go to 32
    s = applyAction(s, { type: 'raise', amount: 20 }); // BTN raises to 20
    s = applyAction(s, { type: 'call' }); // SB calls 20
    s = applyAction(s, { type: 'raise', amount: 32 }); // BB all-in to 32: raise of 12 < 18 → incomplete
    const l = getLegalActions(s)!;
    expect(s.toAct).toBe(0);
    expect(l.canCall).toBe(true);
    expect(l.canRaise).toBe(false);
  });
});

describe('full hands: chip conservation, no duplicate cards, valid states', () => {
  it('500 random hands with random legal actions', () => {
    const rng = seededRng(99);
    let s = createTable(SEATS, CONFIG);
    for (let h = 0; h < 500; h++) {
      s = startHand(s, rng);
      const chips = totalChips(s);
      let guard = 0;
      while (!s.result && guard++ < 300) {
        const l = getLegalActions(s)!;
        const r = rng();
        let a: { type: 'fold' | 'check' | 'call' | 'bet' | 'raise'; amount?: number };
        if (r < 0.15) a = { type: 'fold' };
        else if (r < 0.6) a = l.canCheck ? { type: 'check' } : { type: 'call' };
        else if (l.canBet || l.canRaise) {
          const to = r > 0.95 ? l.maxTo : Math.min(l.maxTo, l.minTo + Math.floor(rng() * 40));
          a = { type: l.canBet ? 'bet' : 'raise', amount: to };
        } else a = l.canCheck ? { type: 'check' } : { type: 'call' };
        s = applyAction(s, a);
        expect(totalChips(s)).toBe(chips);
      }
      expect(s.result).toBeDefined();
      const cards = [...s.players.flatMap((p) => p.hole), ...s.board, ...s.deck];
      expect(hasDuplicates(cards)).toBe(false);
      const paid = Object.values(s.result!.payouts).reduce((a, b) => a + b, 0);
      const potTotal = s.result!.pots.reduce((a, p) => a + p.amount, 0);
      expect(paid).toBe(potTotal);
      expect(Object.values(s.result!.net).reduce((a, b) => a + b, 0)).toBe(0);
      s.players.forEach((p) => expect(p.stack).toBeGreaterThanOrEqual(0));
      if (s.result!.showdown) expect(s.board).toHaveLength(5);
    }
  });

  it('all-in preflop runs the board out to showdown', () => {
    let s = freshHand(11);
    s = applyAction(s, { type: 'raise', amount: 200 }); // UTG all-in
    for (let i = 0; i < 4; i++) s = applyAction(s, { type: 'fold' });
    s = applyAction(s, { type: 'call' }); // BB calls all-in
    expect(s.result!.showdown).toBe(true);
    expect(s.board).toHaveLength(5);
    expect(totalChips(s)).toBe(1200);
  });

  it('side pot paid correctly with a short stack', () => {
    let s = createTable(SEATS.slice(0, 3), { smallBlind: 1, bigBlind: 2, startingStack: 100 });
    s = startHand(s, seededRng(21));
    s.players[0].stack = 20; // button short (20 behind)
    // Rig cards: short stack has the best hand, BB the second best.
    s.players[0].hole = parseCards('As Ad');
    s.players[1].hole = parseCards('2c 7d');
    s.players[2].hole = parseCards('Ks Kd');
    rigBoard(s, '3h 8s 9c Tc 4d', 'As Ad 2c 7d Ks Kd');
    s = applyAction(s, { type: 'raise', amount: 20 }); // BTN all-in for 20
    s = applyAction(s, { type: 'raise', amount: 60 }); // SB raises
    s = applyAction(s, { type: 'call' }); // BB calls 60
    // Flop: SB and BB check down
    while (!s.result) s = applyAction(s, getLegalActions(s)!.canCheck ? { type: 'check' } : { type: 'call' });
    const main = s.result!.pots[0];
    expect(main.amount).toBe(60);
    expect(main.winners).toEqual(['hero']);
    expect(s.result!.payouts['hero']).toBe(60);
    expect(s.result!.pots[1].amount).toBe(80);
    expect(s.result!.pots[1].winners).toEqual(['b2']);
  });
});

/** Arrange the deck so the next streets deal exactly this board (burn cards taken from the rest). */
function rigBoard(s: GameState, boardStr: string, holeStr: string): void {
  const board = parseCards(boardStr);
  const used = new Set([...board, ...parseCards(holeStr)]);
  const rest = fullDeck().filter((c) => !used.has(c));
  const burns = rest.splice(0, 3);
  // pop() order: burn, flop×3, burn, turn, burn, river
  s.deck = [...rest, board[4], burns[2], board[3], burns[1], board[2], board[1], board[0], burns[0]];
}

describe('player view hides other cards', () => {
  it('bots only see their own hole cards', () => {
    const s = freshHand();
    const v = getPlayerView(s, 'b3');
    expect(v.myHole).toEqual(s.players[3].hole);
    const json = JSON.stringify(v);
    expect(json).not.toContain('"hole"');
    expect(v.players.every((p) => !('hole' in p))).toBe(true);
  });
});

// ---------------------------------------------------------------- outs & draws

describe('outs', () => {
  it('flush draw = 9 outs, 9/47 next card, ~35% by river', () => {
    const r = calculateOuts(parseCards('6h 5h'), parseCards('Kh 2h 9c'));
    expect(r.outs.filter((o) => o.makes === HandCategory.Flush)).toHaveLength(9);
    expect(r.unseen).toBe(47);
    expect(r.nextCardPct).toBeCloseTo(9 / 47);
  });
  it('open-ended straight draw = 8 outs', () => {
    const r = calculateOuts(parseCards('9c 8d'), parseCards('7h 6s 2c'));
    expect(r.outs.filter((o) => o.makes === HandCategory.Straight)).toHaveLength(8);
  });
  it('gutshot = 4 outs', () => {
    const r = calculateOuts(parseCards('9c 8d'), parseCards('6h 5s Kc'));
    expect(r.outs.filter((o) => o.makes === HandCategory.Straight)).toHaveLength(4);
  });
  it('flush draw + OESD = 15 outs', () => {
    const r = calculateOuts(parseCards('9h 8h'), parseCards('7h 6h Kc'));
    expect(r.outs).toHaveLength(15 + 0); // 9 flush + 6 non-heart straight cards... plus pairs excluded
  });
  it('set to full house/quads on the flop = 7 outs', () => {
    const r = calculateOuts(parseCards('7c 7d'), parseCards('7h Ks 2c'));
    expect(r.outs).toHaveLength(7);
  });
  it('board pairing is not an out for hero', () => {
    const r = calculateOuts(parseCards('Ac Kd'), parseCards('7h 5s 2c'));
    // Six overcard outs (3 aces + 3 kings); board pairing cards are excluded.
    expect(r.outs).toHaveLength(6);
  });
  it('two-card odds: 1 - (38/47 × 37/46)', () => {
    const r = calculateOuts(parseCards('6h 5h'), parseCards('Kh 2h 9c'));
    expect(r.byRiverPct).toBeCloseTo(1 - (38 / 47) * (37 / 46));
  });
  it('turn: unseen = 46', () => {
    const r = calculateOuts(parseCards('6h 5h'), parseCards('Kh 2h 9c Jd'));
    expect(r.unseen).toBe(46);
    expect(r.byRiverPct).toBeCloseTo(r.nextCardPct);
  });
});

describe('draws and hand descriptions', () => {
  it('detects nut flush draw and gutshot', () => {
    const d = findDraws(parseCards('Ah 5h'), parseCards('Kh 2h 3c'));
    expect(d.map((x) => x.kind)).toEqual(expect.arrayContaining(['nutFlushDraw', 'gutshot']));
  });
  it('detects OESD', () => {
    expect(findDraws(parseCards('9c 8d'), parseCards('7h 6s 2c')).map((x) => x.kind)).toContain('oesd');
  });
  it('top pair top kicker / overpair / set', () => {
    expect(describeMadeHand(parseCards('Ac Kd'), parseCards('Kh 7s 2c')).he).toContain('Top Pair');
    expect(describeMadeHand(parseCards('Qc Qd'), parseCards('Jh 7s 2c')).he).toContain('Overpair');
    expect(describeMadeHand(parseCards('7c 7d'), parseCards('Jh 7s 2c')).tier).toBe('monster');
  });
  it('playing the board on the river', () => {
    const info = describeMadeHand(parseCards('2c 3d'), parseCards('Ah Kh Qd Jc Ts'));
    expect(info.playingTheBoard).toBe(true);
  });
  it('board texture', () => {
    expect(analyzeBoard(parseCards('Kh 7s 2c')).wetness).toBe('dry');
    expect(analyzeBoard(parseCards('9h 8h 7c')).wetness).toBe('wet');
    expect(analyzeBoard(parseCards('9h 8h 7h')).monotone).toBe(true);
  });
});

describe('relative strength and equity', () => {
  it('nut straight beats almost everything', () => {
    const r = relativeStrength(parseCards('Ac Kd'), parseCards('Qh Js Tc 2d 3h'));
    expect(r.total).toBe(990); // C(45,2)
    expect(r.losesTo).toBe(0);
  });
  it('AA vs random ≈ 85%', () => {
    const r = equity({ hero: parseCards('As Ah'), board: [], opponents: [null], iterations: 6000, rng: seededRng(5) });
    expect(r.equity).toBeGreaterThan(0.82);
    expect(r.equity).toBeLessThan(0.88);
  });
  it('flush draw vs set on the flop ≈ 25-30%', () => {
    const villain = [{ cards: parseCards('Kc Kd') as [number, number], weight: 1 }];
    const r = equity({ hero: parseCards('Ah 7h'), board: parseCards('Kh 2h 9c'), opponents: [villain], iterations: 6000, rng: seededRng(8) });
    expect(r.equity).toBeGreaterThan(0.22);
    expect(r.equity).toBeLessThan(0.33);
  });
});

describe('hand classes', () => {
  it('169 classes covering 1326 combos', () => {
    const cls = allClasses();
    expect(cls).toHaveLength(169);
    expect(cls.reduce((s, c) => s + comboCount(c), 0)).toBe(1326);
    expect(cls.reduce((s, c) => s + combosOf(c).length, 0)).toBe(1326);
  });
  it('classOf', () => {
    expect(classOf(parseCards('Kd As'))).toBe('AKo');
    expect(classOf(parseCards('7h 8h'))).toBe('87s');
    expect(classOf(parseCards('Tc Td'))).toBe('TT');
  });
  it('AA is the best percentile, 32o the worst', () => {
    expect(preflopPercentile('AA')).toBeCloseTo(6 / 1326);
    expect(preflopPercentile('32o')).toBeCloseTo(1);
    expect(topRange(0.05)).toContain('KK');
    expect(topRange(0.05)).not.toContain('72o');
  });
});
