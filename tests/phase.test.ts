/**
 * 累積位相の検証。分割レンダリングの境界が繋がるかどうかは、ここの正しさに掛かっている。
 */

import { describe, expect, it } from 'vitest';
import type { Breakpoint } from '../src/audio/breakpoints';
import { integratePhase, phaseDifference, wrapPhase } from '../src/audio/phase';

const TWO_PI = Math.PI * 2;
const bp = (pairs: Array<[number, number]>): Breakpoint[] =>
  pairs.map(([t, value]) => ({ t, value }));

describe('integratePhase', () => {
  it('一定周波数では 2π f t', () => {
    const points = bp([[0, 320]]);
    expect(integratePhase(points, 1)).toBeCloseTo(TWO_PI * 320, 9);
    expect(integratePhase(points, 2.5)).toBeCloseTo(TWO_PI * 320 * 2.5, 9);
  });

  it('線形ランプでは平均周波数 × 時間', () => {
    // 100 → 200 Hz を 10 秒: 平均 150 Hz
    const points = bp([
      [0, 100],
      [10, 200],
    ]);
    expect(integratePhase(points, 10)).toBeCloseTo(TWO_PI * 150 * 10, 9);
  });

  it('ランプの途中でも解析解と一致する', () => {
    // f(t) = 100 + 10t、∫₀⁵ = 500 + 125 = 625
    const points = bp([
      [0, 100],
      [10, 200],
    ]);
    expect(integratePhase(points, 5)).toBeCloseTo(TWO_PI * 625, 9);
  });

  it('区間をまたいでも加法的（分割レンダリングの前提）', () => {
    const points = bp([
      [0, 200],
      [30, 260],
      [90, 260],
      [120, 200],
    ]);
    for (const split of [10, 30, 45, 90, 100]) {
      const whole = integratePhase(points, 120);
      const head = integratePhase(points, split);
      // 「頭まで」＋「残り」が全体に一致することを、区間ごとの再計算で確かめる
      const tailPoints = points
        .filter((p) => p.t > split)
        .map((p) => ({ t: p.t - split, value: p.value }));
      const startValue =
        points.find((p) => p.t >= split)?.t === split
          ? points.find((p) => p.t === split)!.value
          : interpolate(points, split);
      const tail = integratePhase([{ t: 0, value: startValue }, ...tailPoints], 120 - split);
      expect(head + tail).toBeCloseTo(whole, 6);
    }
  });

  it('末尾より先は最後の周波数で伸びる', () => {
    const points = bp([
      [0, 100],
      [10, 100],
    ]);
    expect(integratePhase(points, 20)).toBeCloseTo(TWO_PI * 100 * 20, 9);
  });

  it('空の列や 0 秒では 0', () => {
    expect(integratePhase([], 10)).toBe(0);
    expect(integratePhase(bp([[0, 320]]), 0)).toBe(0);
  });
});

function interpolate(points: Breakpoint[], t: number): number {
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    if (t >= a.t && t <= b.t) {
      return a.value + ((b.value - a.value) * (t - a.t)) / (b.t - a.t);
    }
  }
  return points[points.length - 1]!.value;
}

describe('wrapPhase', () => {
  it('[0, 2π) に畳む', () => {
    expect(wrapPhase(0)).toBe(0);
    expect(wrapPhase(TWO_PI)).toBeCloseTo(0, 12);
    expect(wrapPhase(TWO_PI * 3 + 1)).toBeCloseTo(1, 9);
    expect(wrapPhase(-1)).toBeCloseTo(TWO_PI - 1, 9);
  });

  it('大きな累積値でも精度が保たれる', () => {
    // 25 分ぶんの 320 Hz = 約 300 万ラジアン
    const phase = TWO_PI * 320 * 1500;
    const wrapped = wrapPhase(phase);
    expect(wrapped).toBeGreaterThanOrEqual(0);
    expect(wrapped).toBeLessThan(TWO_PI);
    // 320 Hz × 1500 秒はちょうど 480000 周期なので位相は 0 に戻る
    expect(Math.min(wrapped, TWO_PI - wrapped)).toBeLessThan(1e-6);
  });
});

describe('phaseDifference', () => {
  it('[−π, π] に正規化する', () => {
    expect(phaseDifference(0.1, 0)).toBeCloseTo(0.1, 12);
    expect(phaseDifference(0, TWO_PI)).toBeCloseTo(0, 12);
    expect(phaseDifference(0.1, TWO_PI - 0.1)).toBeCloseTo(0.2, 9);
  });

  it('境界の連続性の判定に使える', () => {
    const points = bp([[0, 200]]);
    // 30 秒時点の位相と、15 秒 + 15 秒の位相が一致する
    const direct = integratePhase(points, 30);
    const split = integratePhase(points, 15) + integratePhase(points, 15);
    expect(Math.abs(phaseDifference(wrapPhase(direct), wrapPhase(split)))).toBeLessThan(1e-9);
  });
});
