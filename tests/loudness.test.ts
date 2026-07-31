import { describe, expect, it } from 'vitest';
import {
  carrierGain,
  dbToGain,
  equalLoudnessGainDb,
  gainToDb,
  LOUDNESS_TABLE,
} from '../src/audio/loudness';

describe('equalLoudnessGainDb', () => {
  it('テーブルの点で一致する', () => {
    for (const { hz, db } of LOUDNESS_TABLE) {
      expect(equalLoudnessGainDb(hz)).toBeCloseTo(db, 6);
    }
  });

  it('周波数が上がるほど補正が小さくなる（単調減少）', () => {
    let prev = Infinity;
    for (let hz = 60; hz <= 700; hz += 5) {
      const db = equalLoudnessGainDb(hz);
      expect(db).toBeLessThanOrEqual(prev + 1e-9);
      prev = db;
    }
  });

  it('テーブル範囲外は端の値でクランプする', () => {
    expect(equalLoudnessGainDb(20)).toBeCloseTo(LOUDNESS_TABLE[0]!.db, 6);
    const last = LOUDNESS_TABLE[LOUDNESS_TABLE.length - 1]!;
    expect(equalLoudnessGainDb(5000)).toBeCloseTo(last.db, 6);
  });

  it('400 Hz が 0 dB の基準になっている', () => {
    expect(equalLoudnessGainDb(400)).toBeCloseTo(0, 6);
  });

  it('テーブル点の間では両端の値の間に収まる', () => {
    const mid = equalLoudnessGainDb(220);
    expect(mid).toBeLessThan(equalLoudnessGainDb(200));
    expect(mid).toBeGreaterThan(equalLoudnessGainDb(250));
  });
});

describe('dbToGain / gainToDb', () => {
  it('往復して元に戻る', () => {
    for (const db of [-60, -30, -12, -6, 0]) {
      expect(gainToDb(dbToGain(db))).toBeCloseTo(db, 9);
    }
  });

  it('0 dB は 1.0', () => {
    expect(dbToGain(0)).toBeCloseTo(1, 12);
  });

  it('−6 dB はおよそ半分の振幅', () => {
    expect(dbToGain(-6)).toBeCloseTo(0.501, 3);
  });
});

describe('carrierGain', () => {
  it('低い搬送波ほどゲインが高くなる', () => {
    expect(carrierGain(-30, 160)).toBeGreaterThan(carrierGain(-30, 400));
  });

  it('−6 dBFS を超えない', () => {
    expect(gainToDb(carrierGain(0, 80))).toBeLessThanOrEqual(-6 + 1e-9);
  });

  it('既定レベルではクリップから十分離れている', () => {
    for (const hz of [160, 200, 240, 280, 320, 400]) {
      expect(carrierGain(-30, hz)).toBeLessThan(0.2);
    }
  });
});
