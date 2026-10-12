/** Game controller hook: connects the engine, bots, coach, stats and storage to React. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { defaultRng, shuffle } from '../engine/cards';
import { createTable, startHand, applyAction, getPlayerView, GameState, SeatSetup, PlayerAction } from '../engine/game';
import { decideBotAction } from '../bots/bot';
import { localCoach, DecisionAnalysis, Quiz, Topic, HeroDecision } from '../coach';
import { recordDecision, recordHand, recordQuiz, quizProbability, LEVEL_TOPICS, Stats, buildReport, TrainingReport } from '../training/stats';
import { adaptiveHole } from '../training/adaptive';
import { buildHandRecord, HandRecord } from '../training/history';
import { repo, Preferences } from '../storage/repository';
import { ProfileId } from '../bots/profiles';
import { levelProgress, progressLines } from '../training/progress';
import { saveFileViaHost } from '../storage/cloudSync';

export const HERO_ID = 'hero';
const BOT_NAMES = ['רון', 'מיכל', 'עומר', 'שירה', 'איתי'];
const PROFILE_IDS: ProfileId[] = ['tight', 'loose', 'aggressive', 'passive', 'balanced'];
export const TABLE_CONFIG = { smallBlind: 1, bigBlind: 2, startingStack: 200 };

const rng = defaultRng();

function newTable(heroName: string): GameState {
  const profiles = shuffle(PROFILE_IDS, rng);
  const seats: SeatSetup[] = [
    { id: HERO_ID, name: heroName || 'אתה', isHero: true },
    ...BOT_NAMES.map((name, i) => ({ id: `bot${i + 1}`, name, isHero: false, profile: profiles[i] })),
  ];
  return createTable(seats, TABLE_CONFIG);
}

export interface QuizState {
  quiz: Quiz;
  answered: number | null;
}

export function useTrainer() {
  const [prefs, setPrefs] = useState<Preferences>(() => repo.loadPrefs());
  const [session, setSession] = useState<Stats>(() => repo.loadSession());
  const [lifetime, setLifetime] = useState<Stats>(() => repo.loadLifetime());
  const [history, setHistory] = useState<HandRecord[]>(() => repo.loadHistory());
  const [game, setGame] = useState<GameState>(() => newTable(repo.loadPrefs().playerName));
  const [handDecisions, setHandDecisions] = useState<DecisionAnalysis[]>([]);
  const [analysis, setAnalysis] = useState<DecisionAnalysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [quiz, setQuiz] = useState<QuizState | null>(null);
  const [adaptiveTopic, setAdaptiveTopic] = useState<Topic | null>(null);
  const [report, setReport] = useState<TrainingReport | null>(null);
  const recordedHand = useRef(0);
  const quizAskedFor = useRef('');
  const level = prefs.level;

  const updatePrefs = useCallback((p: Partial<Preferences>) => {
    if (p.level === 4 || p.quizzes === false) setQuiz(null);
    if (p.playerName !== undefined) {
      const name = p.playerName.trim() || 'אתה';
      setGame((g) => ({ ...g, players: g.players.map((pl) => (pl.id === HERO_ID ? { ...pl, name } : pl)) }));
    }
    setPrefs((cur) => {
      const next = { ...cur, ...p };
      repo.savePrefs(next);
      return next;
    });
  }, []);

  const saveStats = useCallback((fn: (s: Stats) => Stats) => {
    setSession((s) => {
      const n = fn(s);
      repo.saveSession(n);
      return n;
    });
    setLifetime((s) => {
      const n = fn(s);
      repo.saveLifetime(n);
      return n;
    });
  }, []);

  const heroIndex = game.players.findIndex((p) => p.id === HERO_ID);
  const heroToAct = !game.result && game.toAct === heroIndex && game.handNumber > 0;
  const handOver = !!game.result || game.handNumber === 0;
  const view = useMemo(() => (game.handNumber > 0 ? getPlayerView(game, HERO_ID) : null), [game]);

  const nextHand = useCallback(() => {
    setAnalysis(null);
    setQuiz(null);
    setHandDecisions([]);
    setGame((g) => {
      const deal = prefs.adaptive ? adaptiveHole(lifetime, rng) : null;
      setAdaptiveTopic(deal?.topic ?? null);
      return startHand(g, rng, deal ? { forcedHole: { [HERO_ID]: deal.hole } } : {});
    });
  }, [prefs.adaptive, lifetime]);

  // Bots act after a short delay, paused while the analysis or a quiz is open.
  useEffect(() => {
    if (game.result || game.handNumber === 0 || game.toAct < 0) return;
    const p = game.players[game.toAct];
    if (p.isHero || analysis || analyzing) return;
    const t = setTimeout(() => {
      setGame((g) => {
        if (g.result || g.toAct < 0 || g.players[g.toAct].id !== p.id) return g;
        const action: PlayerAction = decideBotAction(getPlayerView(g, p.id), p.profile, rng);
        return applyAction(g, action);
      });
    }, prefs.botDelayMs);
    return () => clearTimeout(t);
  }, [game, analysis, analyzing, prefs.botDelayMs]);

  // Ask an adaptive quiz question when it becomes the hero's turn on a new street.
  useEffect(() => {
    if (!heroToAct || !view || level === 4 || !prefs.quizzes) return;
    const key = `${game.handNumber}-${game.street}`;
    if (quizAskedFor.current === key) return;
    quizAskedFor.current = key;
    const topics = shuffle(LEVEL_TOPICS[level], rng);
    for (const t of topics) {
      if (rng() > quizProbability(lifetime, t)) continue;
      const q = localCoach.makeQuiz(view, t, rng);
      if (q) {
        setQuiz({ quiz: q, answered: null });
        return;
      }
    }
  }, [heroToAct, view, level, prefs.quizzes, game.handNumber, game.street, lifetime]);

  const answerQuiz = useCallback((idx: number) => {
    setQuiz((q) => {
      if (!q || q.answered !== null) return q;
      const correct = q.quiz.options[idx].correct;
      saveStats((s) => recordQuiz(s, q.quiz.topic, correct, level));
      return { ...q, answered: idx };
    });
  }, [saveStats, level]);

  const heroAct = useCallback((decision: HeroDecision) => {
    if (!heroToAct || !view) return;
    setQuiz(null);
    setAnalyzing(true);
    const before = game;
    // Let the UI paint the "analyzing" state before the simulation runs.
    setTimeout(() => {
      const a = localCoach.analyzeDecision(getPlayerView(before, HERO_ID), decision, rng);
      saveStats((s) => recordDecision(s, a, decision.type, level));
      setHandDecisions((d) => [...d, a]);
      setGame(applyAction(before, decision));
      if (level !== 4) setAnalysis(a);
      setAnalyzing(false);
    }, 30);
  }, [heroToAct, view, game, level, saveStats]);

  // Record a finished hand once.
  useEffect(() => {
    if (!game.result || recordedHand.current === game.handNumber) return;
    recordedHand.current = game.handNumber;
    const net = game.result.net[HERO_ID] ?? 0;
    const won = Object.keys(game.result.payouts).includes(HERO_ID) && net > 0;
    saveStats((s) => recordHand(s, net, game.config.bigBlind, won, level));
    setHistory(repo.addHand(buildHandRecord(game, HERO_ID, level, handDecisions)));
  }, [game, handDecisions, level, saveStats]);

  const progress = useMemo(() => levelProgress(lifetime.levels, level, prefs.quizzes), [lifetime, level, prefs.quizzes]);

  const toggleStar = useCallback((id: string) => setHistory(repo.toggleStar(id)), []);

  /** Re-reads everything from storage (after a restore, or progress synced from another device). */
  const reloadFromStorage = useCallback(() => {
    const p = repo.loadPrefs();
    setPrefs(p);
    setSession(repo.loadSession());
    setLifetime(repo.loadLifetime());
    setHistory(repo.loadHistory());
    const name = p.playerName.trim() || 'אתה';
    setGame((g) => ({ ...g, players: g.players.map((pl) => (pl.id === HERO_ID ? { ...pl, name } : pl)) }));
  }, []);

  useEffect(() => {
    window.addEventListener('pt-cloud-updated', reloadFromStorage);
    return () => window.removeEventListener('pt-cloud-updated', reloadFromStorage);
  }, [reloadFromStorage]);

  /** Saves all stored data as a JSON file. */
  const downloadBackup = useCallback(async () => {
    const backup = repo.exportAll();
    const text = JSON.stringify(backup, null, 1);
    const filename = `poker-trainer-backup-${backup.exportedAt.slice(0, 10)}.json`;
    // On claude.ai the page cannot download directly; the viewer's save prompt does it.
    if (await saveFileViaHost(filename, text)) return;
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, []);

  /** Restores data from a backup file, then reloads so every part of the app reads it. */
  const restoreBackup = useCallback(async (file: File): Promise<string | null> => {
    try {
      repo.importAll(JSON.parse(await file.text()));
    } catch (e) {
      return e instanceof Error && e.name !== 'SyntaxError' ? e.message : 'לא הצלחתי לקרוא את הקובץ';
    }
    reloadFromStorage();
    return null;
  }, [reloadFromStorage]);

  const endSession = useCallback(() => {
    const rep = buildReport(session, prefs.playerName);
    rep.lines.push(...progressLines(levelProgress(lifetime.levels, level, prefs.quizzes), prefs.playerName || 'אתה'));
    setReport(rep);
  }, [session, lifetime, level, prefs.playerName, prefs.quizzes]);

  const startNewSession = useCallback(() => {
    setSession(repo.newSession());
    setReport(null);
    setGame(newTable(repo.loadPrefs().playerName));
    setHandDecisions([]);
    setAnalysis(null);
    setQuiz(null);
  }, []);

  const resetAll = useCallback(() => {
    repo.resetAll();
    setPrefs(repo.loadPrefs());
    setSession(repo.loadSession());
    setLifetime(repo.loadLifetime());
    setHistory([]);
    setGame(newTable(repo.loadPrefs().playerName));
    setHandDecisions([]);
    setAnalysis(null);
  }, []);

  return {
    game, view, prefs, updatePrefs, progress, downloadBackup, restoreBackup, session, lifetime, history, level,
    heroToAct, handOver, heroIndex, handDecisions,
    analysis, closeAnalysis: () => setAnalysis(null), analyzing,
    quiz, answerQuiz, closeQuiz: () => setQuiz(null),
    adaptiveTopic, nextHand, heroAct, toggleStar,
    report, endSession, startNewSession, closeReport: () => setReport(null), resetAll,
    thinkSteps: view && heroToAct ? localCoach.thinkSteps(view) : [],
  };
}

export type Trainer = ReturnType<typeof useTrainer>;
