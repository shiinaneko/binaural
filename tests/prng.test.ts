import { describe, expect, it } from 'vitest';
import { bipolar, mulberry32, seedFromString } from '../src/audio/prng';

describe('mulberry32', () => {
  it('同じシードなら同じ列を返す（書き出しと再生の一致に必要）', () => {
    const a = mulberry32(12345);
    const b = mulberry32(12345);
    for (let i = 0; i < 100; i++) {
      expect(a()).toBe(b());
    }
  });

  it('シードが違えば列が変わる', () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    const same = Array.from({ length: 50 }, () => a() === b()).filter(Boolean).length;
    expect(same).toBe(0);
  });

  it('0–1 の範囲に収まる', () => {
    const rand = mulberry32(99);
    for (let i = 0; i < 10000; i++) {
      const v = rand();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('平均がおよそ 0.5 に寄る', () => {
    const rand = mulberry32(7);
    let sum = 0;
    const n = 100000;
    for (let i = 0; i < n; i++) sum += rand();
    expect(sum / n).toBeCloseTo(0.5, 2);
  });
});

describe('bipolar', () => {
  it('−1..1 に写す', () => {
    const rand = mulberry32(3);
    for (let i = 0; i < 1000; i++) {
      const v = bipolar(rand);
      expect(v).toBeGreaterThanOrEqual(-1);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('seedFromString', () => {
  it('同じ文字列は同じシードになる', () => {
    expect(seedFromString('deep-work')).toBe(seedFromString('deep-work'));
  });

  it('異なる文字列は異なるシードになる', () => {
    const ids = ['deep-work', 'flow', 'reading', 'creative', 'unwind', 'brown', 'pink', 'rain'];
    expect(new Set(ids.map(seedFromString)).size).toBe(ids.length);
  });

  it('32bit 符号なし整数を返す', () => {
    const seed = seedFromString('pre-sleep');
    expect(Number.isInteger(seed)).toBe(true);
    expect(seed).toBeGreaterThanOrEqual(0);
    expect(seed).toBeLessThanOrEqual(0xffffffff);
  });
});
