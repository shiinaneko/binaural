import { describe, expect, it } from 'vitest';
import {
  bandForBeatHz,
  clampBeatHz,
  clampCarrierHz,
  isValidPair,
  minCarrierForBeat,
  sideFrequencies,
} from '../src/audio/carrier';
import { CARRIER_MAX_HZ, CARRIER_MIN_HZ, SIDE_MIN_HZ } from '../src/audio/types';

describe('sideFrequencies', () => {
  it('左右の差がちょうど Δf になる', () => {
    for (const carrier of [80, 160, 200, 240, 320, 400, 600]) {
      for (const beat of [0.5, 2, 6, 7.83, 10, 14, 16, 40, 45]) {
        const { left, right } = sideFrequencies(carrier, beat);
        expect(right - left).toBeCloseTo(beat, 10);
        expect((left + right) / 2).toBeCloseTo(carrier, 10);
      }
    }
  });

  it('搬送波を中心に左右対称に開く', () => {
    expect(sideFrequencies(240, 10)).toEqual({ left: 235, right: 245 });
  });
});

describe('isValidPair', () => {
  it('許容範囲の組み合わせは通す', () => {
    // fc=80, Δf=45 → left = 57.5 で SIDE_MIN_HZ を上回る
    expect(isValidPair(80, 45)).toBe(true);
    expect(isValidPair(240, 10)).toBe(true);
  });

  it('搬送波の下限が SIDE_MIN_HZ の制約より厳しいことを確認する', () => {
    // CARRIER_MIN_HZ の範囲内では left が SIDE_MIN_HZ を割ることはない。
    // 将来 CARRIER_MIN_HZ を下げたときにこの前提が崩れることを検知する。
    expect(sideFrequencies(CARRIER_MIN_HZ, 45).left).toBeGreaterThan(SIDE_MIN_HZ);
  });

  it('搬送波の範囲外を弾く', () => {
    expect(isValidPair(CARRIER_MIN_HZ - 1, 10)).toBe(false);
    expect(isValidPair(CARRIER_MAX_HZ + 1, 10)).toBe(false);
    expect(isValidPair(CARRIER_MIN_HZ, 10)).toBe(true);
    expect(isValidPair(CARRIER_MAX_HZ, 10)).toBe(true);
  });

  it('Δf の範囲外を弾く', () => {
    expect(isValidPair(240, 0.4)).toBe(false);
    expect(isValidPair(240, 46)).toBe(false);
  });

  it('minCarrierForBeat の値でちょうど左チャンネルが下限に一致する', () => {
    const beat = 16;
    const fc = minCarrierForBeat(beat);
    expect(sideFrequencies(fc, beat).left).toBeCloseTo(SIDE_MIN_HZ, 10);
  });
});

describe('clamp', () => {
  it('搬送波をクランプする', () => {
    expect(clampCarrierHz(10)).toBe(CARRIER_MIN_HZ);
    expect(clampCarrierHz(10_000)).toBe(CARRIER_MAX_HZ);
    expect(clampCarrierHz(240)).toBe(240);
  });

  it('Δf をクランプする', () => {
    expect(clampBeatHz(0)).toBe(0.5);
    expect(clampBeatHz(100)).toBe(45);
  });
});

describe('bandForBeatHz', () => {
  it('境界を含めて帯域を引く', () => {
    expect(bandForBeatHz(2)).toBe('delta');
    expect(bandForBeatHz(4)).toBe('theta');
    expect(bandForBeatHz(7.83)).toBe('theta');
    expect(bandForBeatHz(8)).toBe('alpha');
    expect(bandForBeatHz(12)).toBe('smr');
    expect(bandForBeatHz(15)).toBe('beta');
    expect(bandForBeatHz(40)).toBe('gamma');
  });
});
