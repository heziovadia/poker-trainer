/** Training statistics, the session Training Report and adaptive topic weighting. */
import { DecisionAnalysis, MistakeTag, Topic, TOPIC_HE, MISTAKE_HE, MISTAKE_TOPIC, Level } from '../coach/types';
import { Street } from '../engine/game';
import { LevelLogs, addLevelEvent, addLevelHand } from './progress';

export interface TopicScore {
  right: number;
  total: number;
}

export interface Stats {
  hands: number;
  handsWon: number;
  /** Net result in big blinds (training only). */
  netBB: number;
  preflopDecisions: number;
  postflopDecisions: number;
  grades: { good: number; ok: number; mistake: number };
  mistakes: Record<MistakeTag, number>;
  actions: { fold: number; check: number; call: number; bet: number; raise: number };
  bluffs: number;
  valueBets: number;
  semiBluffs: number;
  /** Decision quality per topic involved in the decision. */
  topicDecisions: Partial<Record<Topic, TopicScore>>;
  /** Quiz answers per topic. */
  quiz: Partial<Record<Topic, TopicScore>>;
  /** Recent results per training level, used for level progression. */
  levels?: LevelLogs;
  startedAt: number;
}

export function emptyStats(): Stats {
  return {
    hands: 0, handsWon: 0, netBB: 0, preflopDecisions: 0, postflopDecisions: 0,
    grades: { good: 0, ok: 0, mistake: 0 },
    mistakes: { potOdds: 0, betSizing: 0, position: 0, preflopRange: 0, freeFold: 0, passive: 0, overaggressive: 0 },
    actions: { fold: 0, check: 0, call: 0, bet: 0, raise: 0 },
    bluffs: 0, valueBets: 0, semiBluffs: 0,
    topicDecisions: {}, quiz: {}, startedAt: Date.now(),
  };
}

/** Fills fields missing from older saved versions. */
export function normalizeStats(s: Partial<Stats> | null): Stats {
  const e = emptyStats();
  if (!s) return e;
  return {
    ...e, ...s,
    grades: { ...e.grades, ...s.grades },
    mistakes: { ...e.mistakes, ...s.mistakes },
    actions: { ...e.actions, ...s.actions },
    topicDecisions: { ...s.topicDecisions },
    quiz: { ...s.quiz },
    levels: { ...s.levels },
  };
}

export function recordDecision(s: Stats, a: DecisionAnalysis, actionType: keyof Stats['actions'], level?: Level): Stats {
  const n = normalizeStats(structuredClone(s));
  if (level) n.levels = addLevelEvent(n.levels, level, { k: 'd', ok: a.grade !== 'mistake', po: a.mistakes.includes('potOdds') });
  if (a.street === 'preflop') n.preflopDecisions++;
  else n.postflopDecisions++;
  n.grades[a.grade]++;
  n.actions[actionType]++;
  for (const m of a.mistakes) n.mistakes[m]++;
  if (a.betKind === 'bluff') n.bluffs++;
  if (a.betKind === 'value') n.valueBets++;
  if (a.betKind === 'semiBluff') n.semiBluffs++;
  const mistakeTopics = new Set(a.mistakes.map((m) => MISTAKE_TOPIC[m]));
  // Only topics a decision can actually be judged on; the rest are measured by quizzes.
  const judgeable = new Set(Object.values(MISTAKE_TOPIC));
  for (const t of a.topics.filter((x) => judgeable.has(x))) {
    const cur = n.topicDecisions[t] ?? { right: 0, total: 0 };
    cur.total++;
    if (a.grade !== 'mistake' || !mistakeTopics.has(t)) cur.right += a.grade === 'mistake' ? 0.5 : 1;
    n.topicDecisions[t] = cur;
  }
  return n;
}

export function recordQuiz(s: Stats, topic: Topic, correct: boolean, level?: Level): Stats {
  const n = normalizeStats(structuredClone(s));
  if (level) n.levels = addLevelEvent(n.levels, level, { k: 'q', ok: correct });
  const cur = n.quiz[topic] ?? { right: 0, total: 0 };
  cur.total++;
  if (correct) cur.right++;
  n.quiz[topic] = cur;
  return n;
}

export function recordHand(s: Stats, netChips: number, bigBlind: number, won: boolean, level?: Level): Stats {
  const n = normalizeStats(structuredClone(s));
  if (level) n.levels = addLevelHand(n.levels, level);
  n.hands++;
  if (won) n.handsWon++;
  n.netBB += netChips / bigBlind;
  return n;
}

/** Combined accuracy per topic from quizzes and decisions (Laplace-smoothed). */
export function topicAccuracy(s: Stats): Record<Topic, { acc: number; samples: number }> {
  const out = {} as Record<Topic, { acc: number; samples: number }>;
  for (const t of Object.keys(TOPIC_HE) as Topic[]) {
    const q = s.quiz[t] ?? { right: 0, total: 0 };
    const d = s.topicDecisions[t] ?? { right: 0, total: 0 };
    const right = q.right + d.right;
    const total = q.total + d.total;
    out[t] = { acc: (right + 1) / (total + 2), samples: total };
  }
  return out;
}

// ---------------------------------------------------------------- adaptive training

/** Topics the quiz can ask about at each level. */
export const LEVEL_TOPICS: Record<Level, Topic[]> = {
  1: ['handReading', 'draws', 'boardTexture'],
  2: ['handReading', 'outs', 'potOdds', 'position', 'draws'],
  3: ['potOdds', 'outs', 'boardTexture', 'position', 'draws'],
  4: [],
};

/**
 * Probability of asking a quiz on a topic: frequent while the player struggles,
 * fading out as accuracy rises (but never fully, so skills get refreshed).
 */
export function quizProbability(s: Stats, topic: Topic): number {
  const { acc, samples } = topicAccuracy(s)[topic];
  if (samples < 3) return 0.45;
  return Math.max(0.08, Math.min(0.85, 0.15 + (1 - acc) * 1.1));
}

/** Topic weights for choosing what to practise: weaker topics weigh more. */
export function weakestTopics(s: Stats, minSamples = 3): Topic[] {
  const acc = topicAccuracy(s);
  return (Object.keys(acc) as Topic[])
    .filter((t) => acc[t].samples >= minSamples)
    .sort((a, b) => acc[a].acc - acc[b].acc);
}

export function strongestTopics(s: Stats, minSamples = 3): Topic[] {
  return weakestTopics(s, minSamples).reverse();
}

// ---------------------------------------------------------------- report

export interface TrainingReport {
  lines: string[];
  hands: number;
  focusTopic: Topic | null;
}

const RECOMMEND: Record<MistakeTag, Topic> = {
  potOdds: 'potOdds',
  betSizing: 'betSizing',
  position: 'position',
  preflopRange: 'preflop',
  freeFold: 'handReading',
  passive: 'valueBluff',
  overaggressive: 'valueBluff',
};

export function buildReport(s: Stats, name = ''): TrainingReport {
  const lines: string[] = [];
  const decisions = s.preflopDecisions + s.postflopDecisions;
  lines.push(`${name ? `${name}, ` : ''}שיחקת ${s.hands} ידיים וקיבלת ${decisions} החלטות (${s.preflopDecisions} לפני הפלופ, ${s.postflopDecisions} אחרי הפלופ).`);
  if (decisions) {
    const g = s.grades;
    lines.push(`איכות ההחלטות: ${g.good} טובות · ${g.ok} סבירות · ${g.mistake} שגויות → ${Math.round(((g.good + g.ok) / decisions) * 100)}% טובות או סבירות ((${g.good} + ${g.ok}) ÷ ${decisions}).`);
  }
  if (s.hands) {
    lines.push(`זכית ב-${s.handsWon} ידיים (${Math.round((s.handsWon / s.hands) * 100)}% = ${s.handsWon} ÷ ${s.hands}). תוצאה נטו: ${s.netBB >= 0 ? '+' : ''}${s.netBB.toFixed(1)} BB (${((s.netBB / s.hands) * 100).toFixed(1)} BB ל-100 ידיים — לצורכי אימון בלבד).`);
  }
  const strong = strongestTopics(s)[0];
  if (strong) lines.push(`החוזקה העיקרית שלך: ${TOPIC_HE[strong]}.`);
  const topMistake = (Object.entries(s.mistakes) as [MistakeTag, number][]).sort((a, b) => b[1] - a[1])[0];
  let focus: Topic | null = null;
  if (topMistake && topMistake[1] > 0) {
    lines.push(`הטעות החוזרת שלך: ${MISTAKE_HE[topMistake[0]]} (${topMistake[1]} פעמים).`);
    focus = RECOMMEND[topMistake[0]];
  } else if (decisions) {
    lines.push('לא נמצאה טעות חוזרת — כל הכבוד!');
  }
  const weak = weakestTopics(s)[0];
  focus = focus ?? weak ?? null;
  if (focus) lines.push(`הנושא המומלץ לאימון הבא: ${TOPIC_HE[focus]}.`);
  lines.push(`פעולות: ${s.actions.fold} Fold · ${s.actions.check} Check · ${s.actions.call} Call · ${s.actions.bet} Bet · ${s.actions.raise} Raise. Value Bets: ${s.valueBets} · Bluffs: ${s.bluffs} · Semi-Bluffs: ${s.semiBluffs}.`);
  return { lines, hands: s.hands, focusTopic: focus };
}

export const streetHe: Record<Street, string> = {
  preflop: 'Preflop', flop: 'Flop', turn: 'Turn', river: 'River', showdown: 'Showdown',
};
