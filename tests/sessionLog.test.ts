import { describe, expect, it } from 'vitest';
import { summarize, type LogEntry } from '../src/state/sessionLog';

function entry(daysAgo: number, completedSec: number, completed = true): LogEntry {
  const date = new Date('2026-07-31T10:00:00');
  date.setDate(date.getDate() - daysAgo);
  return {
    presetId: 'deep-work',
    presetName: 'Deep Work',
    startedAt: date.toISOString(),
    plannedSec: 1500,
    completedSec,
    completed,
  };
}

const now = new Date('2026-07-31T20:00:00');

describe('summarize', () => {
  it('記録が無ければすべて 0', () => {
    const summary = summarize([], now);
    expect(summary).toEqual({
      totalSec: 0,
      sessionCount: 0,
      completedCount: 0,
      streakDays: 0,
      lastWeekSec: 0,
    });
  });

  it('合計時間と完走数を数える', () => {
    const summary = summarize([entry(0, 1500), entry(0, 600, false)], now);
    expect(summary.totalSec).toBe(2100);
    expect(summary.sessionCount).toBe(2);
    expect(summary.completedCount).toBe(1);
  });

  it('連続日数を今日から遡って数える', () => {
    const summary = summarize([entry(0, 1500), entry(1, 1500), entry(2, 1500)], now);
    expect(summary.streakDays).toBe(3);
  });

  it('日が飛んだところで連続が止まる', () => {
    const summary = summarize([entry(0, 1500), entry(1, 1500), entry(3, 1500)], now);
    expect(summary.streakDays).toBe(2);
  });

  it('今日がまだでも、昨日まで続いていれば連続を保つ', () => {
    // 朝いちで「連続が途切れた」と表示されないようにするための挙動
    const summary = summarize([entry(1, 1500), entry(2, 1500)], now);
    expect(summary.streakDays).toBe(2);
  });

  it('2 日以上空いていれば連続は 0', () => {
    const summary = summarize([entry(2, 1500), entry(3, 1500)], now);
    expect(summary.streakDays).toBe(0);
  });

  it('同じ日に複数回やっても連続は 1 日ぶん', () => {
    const summary = summarize([entry(0, 1500), entry(0, 1500), entry(0, 1500)], now);
    expect(summary.streakDays).toBe(1);
  });

  it('直近 7 日ぶんだけを今週として数える', () => {
    const summary = summarize([entry(0, 600), entry(3, 600), entry(10, 600)], now);
    expect(summary.lastWeekSec).toBe(1200);
    expect(summary.totalSec).toBe(1800);
  });
});
