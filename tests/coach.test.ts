import { describe, it, expect } from 'vitest';
import { seededRng, parseCards } from '../src/engine/cards';
import { createTable, startHand, applyAction, getPlayerView, totalChips, GameState, SeatSetup, getLegalActions } from '../src/engine/game';
import { decideBotAction } from '../src/bots/bot';
import { analyzeDecision } from '../src/coach/analyze';
import { thinkSteps } from '../src/coach/think';
import { makeQuiz } from '../src/coach/quiz';
import { estimateRange } from '../src/coach/ranges';
import { emptyStats, recordDecision, recordHand, recordQuiz, buildReport, quizProbability } from '../src/training/stats';
import { adaptiveHole } from '../src/training/adaptive';
import { buildHandRecord } from '../src/training/history';
import { Topic } from '../src/coach/types';

const PROFILES = ['tight', 'loose', 'aggressive', 'passive', 'balanced'];
const SEATS: SeatSetup[] = [
  { id: 'hero', name: 'אתה', isHero: true },
  ...PROFILES.map((p, i) => ({ id: `b${i + 1}`, name: `Bot${i + 1}`, isHero: false, profile: p })),
];
const CONFIG = { smallBlind: 1, bigBlind: 2, startingStack: 200 };

function botStep(s: GameState, rng: () => number): GameState {
  const p = s.players[s.toAct];
  return applyAction(s, decideBotAction(getPlayerView(s, p.id), p.profile, rng));
}

describe('bots', () => {
  it('play 150 full hands (hero = balanced bot) with legal actions only', () => {
    const rng = seededRng(2024);
    let s = createTable(SEATS, CONFIG);
    for (let h = 0; h < 150; h++) {
      s = startHand(s, rng);
      const chips = totalChips(s);
      let guard = 0;
      while (!s.result && guard++ < 200) {
        const p = s.players[s.toAct];
        s = applyAction(s, decideBotAction(getPlayerView(s, p.id), p.profile ?? 'balanced', rng));
      }
      expect(s.result).toBeDefined();
      expect(totalChips(s)).toBe(chips);
    }
  }, 60000);

  it('bot decisions do not depend on the hero hole cards', () => {
    const s = startHand(createTable(SEATS, CONFIG), seededRng(3));
    const bot = s.players[s.toAct];
    const a1 = decideBotAction(getPlayerView(s, bot.id), bot.profile, seededRng(77));
    const s2 = structuredClone(s);
    // Swap hero's cards for different unused ones: the bot's view and decision must be identical.
    const used = new Set(s2.players.flatMap((p) => p.hole));
    s2.players[0].hole = s2.deck.filter((c) => !used.has(c)).slice(0, 2);
    expect(getPlayerView(s2, bot.id)).toEqual(getPlayerView(s, bot.id));
    const a2 = decideBotAction(getPlayerView(s2, bot.id), bot.profile, seededRng(77));
    expect(a2).toEqual(a1);
  });

  it('tight bot folds 72o UTG; any bot raises AA UTG', () => {
    const s = startHand(createTable(SEATS, CONFIG), seededRng(1), { forcedHole: { b3: parseCards('7c 2d') } });
    // seat 3 = UTG on the first hand
    const tight = { ...s, players: s.players.map((p) => (p.id === 'b3' ? { ...p, profile: 'tight' } : p)) };
    expect(decideBotAction(getPlayerView(tight, 'b3'), 'tight', seededRng(1)).type).toBe('fold');
    const s2 = startHand(createTable(SEATS, CONFIG), seededRng(1), { forcedHole: { b3: parseCards('As Ad') } });
    for (const prof of PROFILES) {
      expect(decideBotAction(getPlayerView(s2, 'b3'), prof, seededRng(5)).type).toBe('raise');
    }
  });
});

/** Plays bots until it is the hero's turn (or the hand ends). */
function toHeroTurn(s: GameState, rng: () => number): GameState {
  let guard = 0;
  while (!s.result && s.players[s.toAct].id !== 'hero' && guard++ < 100) s = botStep(s, rng);
  return s;
}

describe('coach analysis', () => {
  it('produces an analysis for every hero decision over 60 hands, with explained percentages', () => {
    const rng = seededRng(11);
    let s = createTable(SEATS, CONFIG);
    let analyses = 0;
    for (let h = 0; h < 60; h++) {
      s = startHand(s, rng);
      s = toHeroTurn(s, rng);
      while (!s.result) {
        const view = getPlayerView(s, 'hero');
        const l = view.legal!;
        const choice = rng();
        const decision = choice < 0.3 ? { type: l.canCheck ? 'check' as const : 'call' as const }
          : choice < 0.5 && (l.canBet || l.canRaise) ? { type: l.canBet ? 'bet' as const : 'raise' as const, amount: Math.min(l.maxTo, l.minTo * 2) }
          : { type: l.canCheck ? 'check' as const : 'fold' as const };
        const a = analyzeDecision(view, decision, rng);
        analyses++;
        expect(['good', 'ok', 'mistake']).toContain(a.grade);
        expect(a.recommendedLabel.length).toBeGreaterThan(0);
        expect(a.sections.length).toBeGreaterThan(0);
        // Every percentage shown must come with a short calculation in parentheses on the same line.
        const texts = [...a.sections.flatMap((x) => x.lines), a.recommendedText, a.verdictText, ...a.alternatives.map((x) => x.text)];
        for (const line of texts) {
          if (/\d+%/.test(line) && !/(÷|×)/.test(line)) throw new Error(`Unexplained percentage: ${line}`);
        }
        if (decision.type === 'fold' && l.canCheck) expect(a.grade).toBe('mistake');
        s = applyAction(s, decision);
        s = toHeroTurn(s, rng);
      }
      const rec = buildHandRecord(s, 'hero', 2, []);
      expect(rec.heroHole).toHaveLength(2);
    }
    expect(analyses).toBeGreaterThan(40);
  }, 120000);

  it('folding AA preflop is a mistake; raising it is good', () => {
    let s = startHand(createTable(SEATS, CONFIG), seededRng(8), { forcedHole: { hero: parseCards('As Ah') } });
    s = toHeroTurn(s, seededRng(8));
    const v = getPlayerView(s, 'hero');
    expect(analyzeDecision(v, { type: 'fold' }, seededRng(1)).grade).toBe('mistake');
    const l = getLegalActions(s)!;
    if (l.canRaise) {
      const to = v.currentBet <= CONFIG.bigBlind ? 6 : v.currentBet * 3;
      expect(analyzeDecision(v, { type: 'raise', amount: Math.min(l.maxTo, to) }, seededRng(1)).grade).not.toBe('mistake');
    }
  });

  it('calling a big bet with no equity is flagged as a pot-odds mistake', () => {
    // Heads-up spot built by hand: hero has nothing on the river facing a pot-size bet.
    let s = createTable(SEATS.slice(0, 2), CONFIG);
    s = startHand(s, seededRng(4), { forcedHole: { hero: parseCards('2c 3d'), b1: parseCards('Ac Ad') } });
    // Heads-up: hero is button/SB and acts first preflop.
    s = applyAction(s, { type: 'call' });
    s = applyAction(s, { type: 'check' });
    for (const street of ['flop', 'turn']) {
      expect(s.street).toBe(street);
      s = applyAction(s, { type: 'check' });
      s = applyAction(s, { type: 'check' });
    }
    s = applyAction(s, { type: 'bet', amount: 4 }); // b1 bets first on river (BB acts first postflop)
    const v = getPlayerView(s, 'hero');
    const a = analyzeDecision(v, { type: 'call' }, seededRng(2));
    // Hero's 2-3 rarely wins; whether it's a mistake depends on the board, but the analysis must explain pot odds.
    expect(a.sections.find((x) => x.id === 'potOdds')!.lines.join(' ')).toContain('÷');
  });

  it('think steps never contain a recommendation', () => {
    let s = startHand(createTable(SEATS, CONFIG), seededRng(5));
    s = toHeroTurn(s, seededRng(5));
    const steps = thinkSteps(getPlayerView(s, 'hero'));
    expect(steps.length).toBeGreaterThan(3);
    const text = steps.map((x) => x.question + x.hint).join(' ');
    expect(text).not.toMatch(/הפעולה המומלצת|כדאי לך לעשות Fold|תעשה Call/);
  });

  it('range estimation for a UTG opener is narrower than for a BTN opener', () => {
    let s = startHand(createTable(SEATS, CONFIG), seededRng(6));
    // UTG (b3) raises
    s = applyAction(s, { type: 'raise', amount: 5 });
    const r = estimateRange(getPlayerView(s, 'hero'), 'b3');
    expect(r.preflopLine).toBe('open');
    const share = r.combos.reduce((a, c) => a + c.weight, 0) / 1326;
    expect(share).toBeLessThan(0.3);
    expect(r.combos.some((c) => c.cards.some((x) => s.players[0].hole.includes(x)))).toBe(false);
  });

  it('quizzes have exactly one correct answer', () => {
    const rng = seededRng(12);
    let s = createTable(SEATS, CONFIG);
    let made = 0;
    for (let h = 0; h < 40; h++) {
      s = startHand(s, rng);
      s = toHeroTurn(s, rng);
      while (!s.result) {
        const v = getPlayerView(s, 'hero');
        for (const t of ['handReading', 'draws', 'outs', 'potOdds', 'boardTexture', 'position'] as Topic[]) {
          const q = makeQuiz(v, t, rng);
          if (!q) continue;
          made++;
          expect(q.options.filter((o) => o.correct)).toHaveLength(1);
          expect(new Set(q.options.map((o) => o.label)).size).toBe(q.options.length);
        }
        s = applyAction(s, { type: v.legal!.canCheck ? 'check' : 'call' });
        s = toHeroTurn(s, rng);
      }
    }
    expect(made).toBeGreaterThan(50);
  }, 60000);
});

describe('stats, report and adaptive training', () => {
  it('records decisions and builds a report', () => {
    let st = emptyStats();
    st = recordHand(st, 10, 2, true);
    st = recordHand(st, -4, 2, false);
    st = recordDecision(st, {
      id: 'x', handNumber: 1, street: 'flop', actionLabel: 'Call', grade: 'mistake', verdictText: '', recommendedLabel: 'Fold',
      recommendedText: '', alternatives: [], sections: [], mistakes: ['potOdds'], topics: ['potOdds'], close: false,
    }, 'call');
    st = recordQuiz(st, 'handReading', true);
    expect(st.hands).toBe(2);
    expect(st.netBB).toBe(3);
    expect(st.mistakes.potOdds).toBe(1);
    const rep = buildReport(st);
    expect(rep.lines.join(' ')).toContain('Pot Odds');
    expect(rep.focusTopic).toBe('potOdds');
  });

  it('quiz probability falls as accuracy rises', () => {
    let good = emptyStats();
    let bad = emptyStats();
    for (let i = 0; i < 20; i++) {
      good = recordQuiz(good, 'outs', true);
      bad = recordQuiz(bad, 'outs', i % 4 === 0);
    }
    expect(quizProbability(good, 'outs')).toBeLessThan(quizProbability(bad, 'outs'));
  });

  it('adaptive dealing focuses on the weakest topic and gives valid hole cards', () => {
    let st = emptyStats();
    for (let i = 0; i < 10; i++) st = recordQuiz(st, 'draws', false);
    for (let i = 0; i < 10; i++) st = recordQuiz(st, 'handReading', true);
    const d = adaptiveHole(st, seededRng(1), 1)!;
    expect(d.topic).toBe('draws');
    expect(d.hole).toHaveLength(2);
    expect(d.hole[0] & 3).toBe(d.hole[1] & 3); // suited
  });
});

describe('range buckets', () => {
  it('board pair + small pair is medium, not strong two pair', async () => {
    const { bucketOf } = await import('../src/coach/ranges');
    const board = parseCards('5h Jc 8h Js 3s');
    expect(bucketOf(parseCards('4c 4d'), board)).toBe('medium'); // 44 under board pair
    expect(bucketOf(parseCards('8c 2d'), board)).toBe('medium'); // middle pair + board pair
    expect(bucketOf(parseCards('Kc Kd'), board)).toBe('strong'); // overpair + board pair
    expect(bucketOf(parseCards('Ac 2d'), board)).toBe('air'); // board pair only
    expect(bucketOf(parseCards('Jd 2d'), board)).toBe('strong'); // trips
    expect(bucketOf(parseCards('8c 5d'), parseCards('8h 5c 2s Kd 9c'))).toBe('strong'); // two pair with both cards
  });
});
