import { describe, it, expect } from 'vitest';
import { levelProgress, addLevelEvent, addLevelHand, LevelLogs, progressLines } from '../src/training/progress';
import { emptyStats, recordHand, recordQuiz } from '../src/training/stats';

function build(hands: number, decisions: boolean[], quizzes: boolean[], level: 1 | 2 | 3 = 1, potOddsMistakes = 0): LevelLogs {
  let logs: LevelLogs = {};
  for (let i = 0; i < hands; i++) logs = addLevelHand(logs, level);
  decisions.forEach((ok, i) => { logs = addLevelEvent(logs, level, { k: 'd', ok, po: i < potOddsMistakes }); });
  quizzes.forEach((ok) => { logs = addLevelEvent(logs, level, { k: 'q', ok }); });
  return logs;
}

const many = (n: number, okShare: number) => Array.from({ length: n }, (_, i) => i < Math.round(n * okShare));

describe('level progression', () => {
  it('a new player is not ready', () => {
    const p = levelProgress({}, 1);
    expect(p.ready).toBe(false);
    expect(p.next).toBe(2);
  });

  it('level 1: ready with enough hands, good decisions and quiz answers', () => {
    const p = levelProgress(build(25, many(30, 0.8), many(12, 0.8)), 1);
    expect(p.criteria.every((c) => c.met)).toBe(true);
    expect(p.ready).toBe(true);
  });

  it('not ready when too few hands even if accuracy is high', () => {
    const p = levelProgress(build(10, many(30, 1), many(12, 1)), 1);
    expect(p.ready).toBe(false);
    expect(p.criteria[0].met).toBe(false);
  });

  it('only recent decisions count: early mistakes do not block progress', () => {
    // 40 early mistakes, then 30 good decisions.
    const decisions = [...many(40, 0), ...many(30, 1)];
    const p = levelProgress(build(30, decisions, many(12, 0.9)), 1);
    expect(p.ready).toBe(true);
    expect(p.improvement!.to).toBeGreaterThan(p.improvement!.from);
  });

  it('level 2 also requires few pot-odds mistakes', () => {
    const p = levelProgress(build(40, many(40, 0.9), many(12, 0.9), 2, 5), 2);
    expect(p.ready).toBe(false);
    expect(p.criteria.find((c) => c.label.includes('Pot Odds'))!.met).toBe(false);
    const ok = levelProgress(build(40, many(40, 0.9), many(12, 0.9), 2, 1), 2);
    expect(ok.ready).toBe(true);
  });

  it('quiz criterion is skipped when quizzes are turned off', () => {
    const p = levelProgress(build(25, many(30, 0.8), []), 1, false);
    expect(p.ready).toBe(true);
  });

  it('level 4 has no next level', () => {
    expect(levelProgress({}, 4).next).toBeNull();
  });

  it('report lines address the player by name and include the calculation', () => {
    const p = levelProgress(build(30, [...many(20, 0.4), ...many(20, 0.9)], many(12, 0.9)), 1);
    const text = progressLines(p, 'חזי').join(' ');
    expect(text).toContain('חזי');
    expect(text).toContain('÷');
  });

  it('stats record per-level hands and quizzes', () => {
    let s = emptyStats();
    s = recordHand(s, 5, 2, true, 2);
    s = recordQuiz(s, 'outs', true, 2);
    expect(s.levels?.[2]?.hands).toBe(1);
    expect(s.levels?.[2]?.events).toHaveLength(1);
  });
});
