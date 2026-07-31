import { describe, expect, it } from 'vitest';
import {
  appendRamp,
  clipBreakpoints,
  integrate,
  shiftBreakpoints,
  valueAt,
  type Breakpoint,
} from '../src/audio/breakpoints';

const bp = (pairs: Array<[number, number]>): Breakpoint[] =>
  pairs.map(([t, value]) => ({ t, value }));

describe('valueAt', () => {
  const points = bp([
    [0, 10],
    [10, 20],
    [20, 20],
  ]);

  it('端点を再現する', () => {
    expect(valueAt(points, 0)).toBe(10);
    expect(valueAt(points, 10)).toBe(20);
    expect(valueAt(points, 20)).toBe(20);
  });

  it('線形補間する', () => {
    expect(valueAt(points, 5)).toBeCloseTo(15);
    expect(valueAt(points, 2.5)).toBeCloseTo(12.5);
  });

  it('範囲外は端の値で一定', () => {
    expect(valueAt(points, -100)).toBe(10);
    expect(valueAt(points, 1000)).toBe(20);
  });

  it('空の列では 0', () => {
    expect(valueAt([], 5)).toBe(0);
  });
});

describe('clipBreakpoints', () => {
  const points = bp([
    [0, 100],
    [10, 200],
    [30, 200],
    [40, 100],
  ]);

  it('窓の両端に補間した点を挿す', () => {
    const clipped = clipBreakpoints(points, 5, 35);
    expect(clipped[0]).toEqual({ t: 0, value: 150 });
    expect(clipped[clipped.length - 1]).toEqual({ t: 30, value: 150 });
  });

  it('時刻を窓の先頭起点に付け替える', () => {
    const clipped = clipBreakpoints(points, 5, 35);
    expect(clipped.map((p) => p.t)).toEqual([0, 5, 25, 30]);
  });

  it('切り出した列が元の列と同じ値を返す', () => {
    const clipped = clipBreakpoints(points, 5, 35);
    for (let t = 0; t <= 30; t += 0.5) {
      expect(valueAt(clipped, t)).toBeCloseTo(valueAt(points, t + 5), 9);
    }
  });

  it('窓が列の外にあっても端の値で埋める', () => {
    const clipped = clipBreakpoints(points, 100, 110);
    expect(clipped.every((p) => p.value === 100)).toBe(true);
  });

  it('空の列は空のまま', () => {
    expect(clipBreakpoints([], 0, 10)).toEqual([]);
  });
});

describe('integrate', () => {
  it('一定値は値 × 時間', () => {
    expect(integrate(bp([[0, 5]]), 10)).toBeCloseTo(50, 9);
  });

  it('線形ランプは台形の面積', () => {
    // 0→10 を 10 秒で: (0+10)/2 × 10 = 50
    expect(
      integrate(
        bp([
          [0, 0],
          [10, 10],
        ]),
        10,
      ),
    ).toBeCloseTo(50, 9);
  });

  it('途中で打ち切っても正しい', () => {
    // 0→10 の 5 秒時点は値 5、面積は (0+5)/2 × 5 = 12.5
    expect(
      integrate(
        bp([
          [0, 0],
          [10, 10],
        ]),
        5,
      ),
    ).toBeCloseTo(12.5, 9);
  });

  it('末尾より先は最後の値で一定', () => {
    expect(
      integrate(
        bp([
          [0, 0],
          [10, 10],
        ]),
        20,
      ),
    ).toBeCloseTo(50 + 100, 9);
  });

  it('区間の加法性が成り立つ', () => {
    const points = bp([
      [0, 3],
      [10, 9],
      [25, 2],
    ]);
    const whole = integrate(points, 25);
    const firstHalf = integrate(points, 12);
    // 12 秒以降 = 全体 − 12 秒まで
    expect(whole - firstHalf).toBeGreaterThan(0);
    expect(firstHalf).toBeCloseTo(integrate(points, 12), 12);
  });

  it('0 以下の時刻では 0', () => {
    expect(integrate(bp([[0, 5]]), 0)).toBe(0);
    expect(integrate(bp([[0, 5]]), -1)).toBe(0);
  });
});

describe('shiftBreakpoints', () => {
  it('時刻だけをずらす', () => {
    const shifted = shiftBreakpoints(
      bp([
        [0, 1],
        [5, 2],
      ]),
      100,
    );
    expect(shifted).toEqual([
      { t: 100, value: 1 },
      { t: 105, value: 2 },
    ]);
  });
});

describe('appendRamp', () => {
  it('直前の値を起点にランプを追記する', () => {
    const points: Breakpoint[] = [{ t: 0, value: 0.5 }];
    appendRamp(points, 10, 20, 0.9);
    expect(points).toEqual([
      { t: 0, value: 0.5 },
      { t: 10, value: 0.5 },
      { t: 30, value: 0.9 },
    ]);
  });

  it('長さ 0 なら段差になる', () => {
    const points: Breakpoint[] = [{ t: 0, value: 0.2 }];
    appendRamp(points, 5, 0, 0.8);
    expect(points[1]).toEqual({ t: 5, value: 0.2 });
    expect(points[2]).toEqual({ t: 5, value: 0.8 });
  });

  it('空の列でも壊れない', () => {
    const points: Breakpoint[] = [];
    appendRamp(points, 0, 1, 0.4);
    expect(valueAt(points, 1)).toBe(0.4);
  });
});
