/**
 * Level progression: measures recent performance at each training level and decides when the
 * player is ready for the next one. Recent windows (not lifetime totals) are used so that early
 * beginner mistakes do not hold the player back once they have improved.
 */
import { Level } from '../coach/types';

export interface LevelEvent {
  /** d = decision, q = quiz answer */
  k: 'd' | 'q';
  /** true = good or reasonable decision / correct answer */
  ok: boolean;
  /** The decision was flagged as a pot-odds mistake. */
  po?: boolean;
  t: number;
}

export interface LevelLog {
  hands: number;
  events: LevelEvent[];
}

export type LevelLogs = Partial<Record<Level, LevelLog>>;

const MAX_EVENTS = 300;

export function addLevelEvent(logs: LevelLogs | undefined, level: Level, e: Omit<LevelEvent, 't'>): LevelLogs {
  const cur = logs?.[level] ?? { hands: 0, events: [] };
  const events = [...cur.events, { ...e, t: Date.now() }].slice(-MAX_EVENTS);
  return { ...logs, [level]: { ...cur, events } };
}

export function addLevelHand(logs: LevelLogs | undefined, level: Level): LevelLogs {
  const cur = logs?.[level] ?? { hands: 0, events: [] };
  return { ...logs, [level]: { ...cur, hands: cur.hands + 1 } };
}

interface Rule {
  minHands: number;
  /** Share of good/reasonable decisions required in the last `window` decisions. */
  decisionPct: number;
  decisionWindow: number;
  /** Share of correct quiz answers required in the last `window` answers (null = not required). */
  quizPct: number | null;
  quizWindow: number;
  /** Max pot-odds mistakes allowed within the decision window (null = not checked). */
  maxPotOddsMistakes: number | null;
}

export const LEVEL_RULES: Record<1 | 2 | 3, Rule> = {
  1: { minHands: 25, decisionPct: 0.7, decisionWindow: 30, quizPct: 0.75, quizWindow: 20, maxPotOddsMistakes: null },
  2: { minHands: 40, decisionPct: 0.75, decisionWindow: 40, quizPct: 0.75, quizWindow: 20, maxPotOddsMistakes: 3 },
  3: { minHands: 50, decisionPct: 0.8, decisionWindow: 50, quizPct: 0.75, quizWindow: 20, maxPotOddsMistakes: 2 },
};

export const LEVEL_NAMES: Record<Level, string> = {
  1: 'רמה 1 — זיהוי ידיים, לוח ו-Draws',
  2: 'רמה 2 — Position, Outs, Pot Odds ו-Bet Sizing',
  3: 'רמה 3 — Ranges, Value/Bluff ו-Board Texture',
  4: 'רמה 4 — Real Play',
};

export interface Criterion {
  label: string;
  met: boolean;
  /** Current value with its calculation, e.g. "78% (31 ÷ 40)". */
  detail: string;
}

export interface LevelProgress {
  level: Level;
  hands: number;
  criteria: Criterion[];
  ready: boolean;
  /** Share of criteria met, for a progress bar. */
  completion: number;
  /** Improvement: first decisions at this level vs the most recent ones. */
  improvement: { from: number; to: number; fromN: number; toN: number } | null;
  next: Level | null;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

function windowStats(events: LevelEvent[], k: 'd' | 'q', n: number) {
  const list = events.filter((e) => e.k === k).slice(-n);
  const ok = list.filter((e) => e.ok).length;
  return { list, ok, n: list.length, share: list.length ? ok / list.length : 0 };
}

export function levelProgress(logs: LevelLogs | undefined, level: Level, quizzesEnabled = true): LevelProgress {
  const log = logs?.[level] ?? { hands: 0, events: [] };
  const decisions = log.events.filter((e) => e.k === 'd');
  let improvement: LevelProgress['improvement'] = null;
  if (decisions.length >= 20) {
    const size = Math.min(20, Math.floor(decisions.length / 2));
    const first = decisions.slice(0, size);
    const last = decisions.slice(-size);
    improvement = {
      from: first.filter((e) => e.ok).length / size,
      to: last.filter((e) => e.ok).length / size,
      fromN: size,
      toN: size,
    };
  }
  if (level === 4) {
    return { level, hands: log.hands, criteria: [], ready: false, completion: 1, improvement, next: null };
  }

  const r = LEVEL_RULES[level];
  const criteria: Criterion[] = [];
  criteria.push({
    label: `לפחות ${r.minHands} ידיים ברמה הזו`,
    met: log.hands >= r.minHands,
    detail: `${log.hands} ÷ ${r.minHands}`,
  });
  const d = windowStats(log.events, 'd', r.decisionWindow);
  criteria.push({
    label: `לפחות ${pct(r.decisionPct)} החלטות טובות או סבירות ב-${r.decisionWindow} ההחלטות האחרונות`,
    met: d.n >= r.decisionWindow && d.share >= r.decisionPct,
    detail: d.n < r.decisionWindow ? `עוד ${r.decisionWindow - d.n} החלטות למדידה (כרגע ${pct(d.share)} = ${d.ok} ÷ ${d.n || 0})` : `${pct(d.share)} (${d.ok} ÷ ${d.n})`,
  });
  if (r.quizPct !== null && quizzesEnabled) {
    const q = windowStats(log.events, 'q', r.quizWindow);
    const need = Math.min(10, r.quizWindow);
    criteria.push({
      label: `לפחות ${pct(r.quizPct)} תשובות נכונות בשאלות האימון האחרונות`,
      met: q.n >= need && q.share >= r.quizPct,
      detail: q.n < need ? `עוד ${need - q.n} שאלות למדידה (כרגע ${pct(q.share)} = ${q.ok} ÷ ${q.n})` : `${pct(q.share)} (${q.ok} ÷ ${q.n})`,
    });
  }
  if (r.maxPotOddsMistakes !== null) {
    const po = d.list.filter((e) => e.po).length;
    criteria.push({
      label: `לא יותר מ-${r.maxPotOddsMistakes} טעויות Pot Odds באותן החלטות`,
      met: d.n >= r.decisionWindow && po <= r.maxPotOddsMistakes,
      detail: `${po} טעויות ב-${d.n} החלטות`,
    });
  }
  const met = criteria.filter((c) => c.met).length;
  return {
    level,
    hands: log.hands,
    criteria,
    ready: met === criteria.length,
    completion: met / criteria.length,
    improvement,
    next: (level + 1) as Level,
  };
}

/** Short Hebrew lines about progress, for the Training Report. */
export function progressLines(p: LevelProgress, name: string): string[] {
  const lines: string[] = [];
  if (p.improvement && p.improvement.to - p.improvement.from >= 0.1) {
    const i = p.improvement;
    lines.push(`${name}, השתפרת ב${LEVEL_NAMES[p.level].split(' — ')[0]}: החלטות טובות או סבירות עלו מ-${pct(i.from)} (${Math.round(i.from * i.fromN)} ÷ ${i.fromN} הראשונות) ל-${pct(i.to)} (${Math.round(i.to * i.toN)} ÷ ${i.toN} האחרונות).`);
  }
  if (p.ready && p.next) lines.push(`🎓 עמדת בכל הקריטריונים — מומלץ לעבור ל${LEVEL_NAMES[p.next]}.`);
  else if (p.next) {
    const missing = p.criteria.filter((c) => !c.met);
    lines.push(`כדי לעבור ל${LEVEL_NAMES[p.next].split(' — ')[0]} נשאר: ${missing.map((c) => `${c.label} (${c.detail})`).join('; ')}.`);
  }
  return lines;
}
