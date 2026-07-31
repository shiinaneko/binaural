import { describe, expect, it } from 'vitest';
import { GrainScheduler } from '../src/audio/GrainScheduler';
import { mulberry32 } from '../src/audio/prng';

function collect(rate: number, until: number, seed = 1): number[] {
  const scheduler = new GrainScheduler(mulberry32(seed), rate);
  scheduler.start(0);
  const times: number[] = [];
  scheduler.pump(until, (t) => times.push(t));
  return times;
}

describe('GrainScheduler', () => {
  it('start までは何も生成しない', () => {
    const scheduler = new GrainScheduler(mulberry32(1), 25);
    const times: number[] = [];
    scheduler.pump(10, (t) => times.push(t));
    expect(times).toHaveLength(0);
    expect(scheduler.started).toBe(false);
  });

  it('平均発生数がレートに一致する', () => {
    const times = collect(25, 100);
    // 25 粒/秒 × 100 秒 ≒ 2500 粒（Poisson なので誤差 ±5% 程度）
    expect(times.length).toBeGreaterThan(2500 * 0.9);
    expect(times.length).toBeLessThan(2500 * 1.1);
  });

  it('時刻は単調増加し、要求範囲を超えない', () => {
    const times = collect(25, 10);
    for (let i = 1; i < times.length; i++) {
      expect(times[i]!).toBeGreaterThan(times[i - 1]!);
    }
    expect(times[times.length - 1]!).toBeLessThanOrEqual(10);
  });

  it('分割して pump しても、一度に pump した結果と一致する（先読みの継続性）', () => {
    const once = collect(25, 10);

    const scheduler = new GrainScheduler(mulberry32(1), 25);
    scheduler.start(0);
    const stepwise: number[] = [];
    for (let t = 0.5; t <= 10.0001; t += 0.5) {
      scheduler.pump(t, (time) => stepwise.push(time));
    }

    expect(stepwise.length).toBe(once.length);
    for (let i = 0; i < once.length; i++) {
      expect(stepwise[i]!).toBeCloseTo(once[i]!, 9);
    }
  });

  it('同じシードなら同じ雨になる（書き出しと再生の一致）', () => {
    expect(collect(25, 5, 99)).toEqual(collect(25, 5, 99));
  });

  it('シードが違えば別の降り方になる', () => {
    expect(collect(25, 5, 1)).not.toEqual(collect(25, 5, 2));
  });

  it('レート 0 では生成しない', () => {
    expect(collect(0, 10)).toHaveLength(0);
  });

  it('間隔が指数分布に従う（平均 = 1/レート）', () => {
    const times = collect(20, 200);
    const gaps: number[] = [];
    for (let i = 1; i < times.length; i++) gaps.push(times[i]! - times[i - 1]!);
    const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    expect(mean).toBeCloseTo(1 / 20, 2);
  });

  it('安全弁を超える要求では時刻だけ進めて取りこぼしを防ぐ', () => {
    const scheduler = new GrainScheduler(mulberry32(1), 25, 100);
    scheduler.start(0);
    let count = 0;
    scheduler.pump(1000, () => count++);
    expect(count).toBe(100);
    // 次の pump が過去に戻らない
    const times: number[] = [];
    scheduler.pump(1001, (t) => times.push(t));
    for (const t of times) expect(t).toBeGreaterThanOrEqual(1000);
  });
});
