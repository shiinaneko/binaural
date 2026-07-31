import { describe, expect, it } from 'vitest';
import {
  beatHzAt,
  bridgeCurve,
  clampCurveRate,
  constantCurve,
  curveDurationSec,
  maxRateHzPerMin,
  normalizeCurve,
  rampCurve,
  toRampSteps,
} from '../src/audio/BeatCurve';
import { BEAT_MAX_HZ, BEAT_MIN_HZ, type BeatCurve } from '../src/audio/types';

const linear = (points: Array<[number, number]>): BeatCurve => ({
  points: points.map(([t, hz]) => ({ t, hz })),
  interpolation: 'linear',
});

describe('normalizeCurve', () => {
  it('t 昇順にソートする', () => {
    const c = normalizeCurve(linear([[10, 8], [0, 4], [5, 6]]));
    expect(c.points.map((p) => p.t)).toEqual([0, 5, 10]);
  });

  it('先頭が t=0 でなければ同じ hz の点を補う', () => {
    const c = normalizeCurve(linear([[5, 12]]));
    expect(c.points[0]).toEqual({ t: 0, hz: 12 });
  });

  it('同一 t は後の点を採用する', () => {
    const c = normalizeCurve(linear([[0, 4], [5, 6], [5, 9]]));
    expect(c.points).toEqual([{ t: 0, hz: 4 }, { t: 5, hz: 9 }]);
  });

  it('hz を有効範囲にクランプする', () => {
    const c = normalizeCurve(linear([[0, 0.1], [10, 999]]));
    expect(c.points[0]!.hz).toBe(BEAT_MIN_HZ);
    expect(c.points[1]!.hz).toBe(BEAT_MAX_HZ);
  });

  it('点が 1 つもなければ例外を投げる', () => {
    expect(() => normalizeCurve(linear([]))).toThrow();
  });
});

describe('beatHzAt', () => {
  const curve = linear([[0, 10], [100, 20]]);

  it('端点を再現する', () => {
    expect(beatHzAt(curve, 0)).toBeCloseTo(10);
    expect(beatHzAt(curve, 100)).toBeCloseTo(20);
  });

  it('線形補間する', () => {
    expect(beatHzAt(curve, 50)).toBeCloseTo(15);
    expect(beatHzAt(curve, 25)).toBeCloseTo(12.5);
  });

  it('範囲外は端の値で保持する', () => {
    expect(beatHzAt(curve, -10)).toBeCloseTo(10);
    expect(beatHzAt(curve, 500)).toBeCloseTo(20);
  });

  it('smooth 補間は中点で線形と一致し、端では緩やかになる', () => {
    const smooth: BeatCurve = { ...curve, interpolation: 'smooth' };
    expect(beatHzAt(smooth, 50)).toBeCloseTo(15);
    // smoothstep(0.25) = 0.15625 → 10 + 10*0.15625
    expect(beatHzAt(smooth, 25)).toBeCloseTo(11.5625);
    expect(beatHzAt(smooth, 25)).toBeLessThan(beatHzAt(curve, 25));
  });
});

describe('maxRateHzPerMin', () => {
  it('一定カーブは 0', () => {
    expect(maxRateHzPerMin(constantCurve(14, 1500))).toBe(0);
  });

  it('Hz/分で返す', () => {
    // 6 Hz を 180 秒で = 2 Hz/分
    expect(maxRateHzPerMin(linear([[0, 10], [180, 16]]))).toBeCloseTo(2, 6);
  });

  it('時間ゼロでの跳躍は Infinity', () => {
    expect(maxRateHzPerMin({ points: [{ t: 0, hz: 4 }, { t: 0, hz: 12 }], interpolation: 'linear' })).toBe(
      Infinity,
    );
  });
});

describe('clampCurveRate', () => {
  it('上限を超える変化を丸める', () => {
    // 10 → 20 Hz を 60 秒（10 Hz/分）で要求、上限 2 Hz/分
    const clamped = clampCurveRate(linear([[0, 10], [60, 20]]), 2);
    expect(clamped.points[1]!.hz).toBeCloseTo(12);
    expect(maxRateHzPerMin(clamped)).toBeLessThanOrEqual(2 + 1e-9);
  });

  it('上限内のカーブは変えない', () => {
    const original = linear([[0, 10], [180, 16]]);
    expect(clampCurveRate(original, 2).points).toEqual(original.points);
  });

  it('下降方向にも効く', () => {
    const clamped = clampCurveRate(linear([[0, 20], [60, 5]]), 2);
    expect(clamped.points[1]!.hz).toBeCloseTo(18);
  });
});

describe('toRampSteps', () => {
  it('linear は点列をそのまま返す', () => {
    const c = linear([[0, 10], [180, 16]]);
    expect(toRampSteps(c)).toEqual(c.points);
  });

  it('smooth は分割し、端点を保つ', () => {
    const steps = toRampSteps({ points: [{ t: 0, hz: 10 }, { t: 10, hz: 16 }], interpolation: 'smooth' });
    expect(steps.length).toBeGreaterThan(10);
    expect(steps[0]).toEqual({ t: 0, hz: 10 });
    expect(steps[steps.length - 1]!.t).toBeCloseTo(10);
    expect(steps[steps.length - 1]!.hz).toBeCloseTo(16);
  });

  it('長い遷移でもステップ数が上限を超えない', () => {
    const steps = toRampSteps(
      { points: [{ t: 0, hz: 10 }, { t: 3600, hz: 16 }], interpolation: 'smooth' },
      0.5,
    );
    expect(steps.length).toBeLessThanOrEqual(201);
  });

  it('単調な遷移を単調なまま保つ', () => {
    const steps = toRampSteps({ points: [{ t: 0, hz: 10 }, { t: 60, hz: 16 }], interpolation: 'smooth' });
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i]!.hz).toBeGreaterThanOrEqual(steps[i - 1]!.hz);
    }
  });
});

describe('bridgeCurve', () => {
  it('先頭を直前の値からのランプに置き換える', () => {
    const bridged = bridgeCurve(12, constantCurve(6, 600), 20);
    expect(bridged.points[0]).toEqual({ t: 0, hz: 12 });
    expect(beatHzAt(bridged, 20)).toBeCloseTo(6);
    expect(curveDurationSec(bridged)).toBe(600);
  });

  it('bridgeSec が 0 なら元のカーブと同じ', () => {
    const original = constantCurve(6, 600);
    expect(bridgeCurve(12, original, 0).points).toEqual(normalizeCurve(original).points);
  });

  it('橋渡し以降の点は保たれる', () => {
    const curve = linear([[0, 10], [180, 16], [1500, 16]]);
    const bridged = bridgeCurve(6, curve, 20);
    expect(beatHzAt(bridged, 180)).toBeCloseTo(16);
    expect(curveDurationSec(bridged)).toBe(1500);
  });
});

describe('rampCurve', () => {
  it('導入・保持・収束の 3 相を作る', () => {
    const c = rampCurve({ fromHz: 10, toHz: 16, durationSec: 1500, onsetSec: 180, taperSec: 180, endHz: 12 });
    expect(beatHzAt(c, 0)).toBeCloseTo(10);
    expect(beatHzAt(c, 180)).toBeCloseTo(16);
    expect(beatHzAt(c, 700)).toBeCloseTo(16);
    expect(beatHzAt(c, 1500)).toBeCloseTo(12);
    expect(curveDurationSec(c)).toBe(1500);
  });

  it('収束を指定しなければ到達値を保持する', () => {
    const c = rampCurve({ fromHz: 10, toHz: 6, durationSec: 1500, onsetSec: 600 });
    expect(beatHzAt(c, 600)).toBeCloseTo(6);
    expect(beatHzAt(c, 1500)).toBeCloseTo(6);
  });
});
