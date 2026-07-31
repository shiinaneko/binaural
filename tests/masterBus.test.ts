/**
 * マスター段の検証。
 *
 * Web Audio の実物は Node では動かないので、AudioParam の自動化イベントを記録する
 * 最小限のモックを噛ませて「いつ・どの値を予約したか」を検証する。
 * 25 分先のフェードアウトを開始時に予約する設計なので、ここが狂うと
 * 終了時に音が飛ぶ（実際に一度やらかした箇所）。
 */

import { describe, expect, it } from 'vitest';
import { AudioEngine, createSoftClipCurve, volumeToGain } from '../src/audio/AudioEngine';
import { dbToGain } from '../src/audio/loudness';
import { fakeContext, paramOf, type ParamEvent } from './fakeAudio';

function fadeEvents(engine: AudioEngine): ParamEvent[] {
  return paramOf(engine.sessionFade).events;
}

describe('fadeSession', () => {
  it('未来のフェードは「予約済みの値」を起点にする（現在値ではなく）', () => {
    const engine = new AudioEngine(fakeContext());
    engine.fadeSession(0, 0, 0);
    engine.fadeSession(1, 0, 6); // フェードイン
    engine.fadeSession(0, 1492, 8); // 25 分後のフェードアウトを開始時に予約

    const events = fadeEvents(engine);
    const fadeOutStart = events.find((e) => e.type === 'set' && e.time === 1492);
    // ここが 0 だと、25 分後に音が一度消えてから消えるフェードになる
    expect(fadeOutStart?.value).toBe(1);

    const ramp = events.find((e) => e.type === 'ramp' && e.time === 1500);
    expect(ramp?.value).toBe(0);
  });

  it('時間 0 のフェードは即値として予約される', () => {
    const engine = new AudioEngine(fakeContext());
    engine.fadeSession(1, 100, 0);
    const events = fadeEvents(engine).filter((e) => e.time === 100);
    expect(events.map((e) => e.value)).toEqual([0, 1]);
  });

  it('fadeOutNow は予約済みの自動化を捨ててから今の値から繋ぐ', () => {
    const engine = new AudioEngine(fakeContext());
    engine.fadeSession(1, 0, 6);
    engine.fadeSession(0, 1492, 8);
    engine.fadeOutNow(3);

    const events = fadeEvents(engine);
    const holdIndex = events.findIndex((e) => e.type === 'hold');
    expect(holdIndex).toBeGreaterThanOrEqual(0);
    const after = events.slice(holdIndex + 1);
    expect(after).toEqual([{ type: 'ramp', value: 0, time: 3 }]);
  });
});

describe('createSoftClipCurve', () => {
  const curve = createSoftClipCurve(-6);
  const threshold = dbToGain(-6);
  const at = (x: number) => {
    // WaveShaper と同じ写像でテーブルを引く
    const pos = ((x + 1) / 2) * (curve.length - 1);
    const i = Math.floor(pos);
    const frac = pos - i;
    const a = curve[i]!;
    const b = curve[Math.min(i + 1, curve.length - 1)]!;
    return a + (b - a) * frac;
  };

  it('閾値以下は完全に線形（透明）', () => {
    for (const x of [0, 0.05, 0.1, 0.25, 0.4, threshold * 0.99]) {
      expect(at(x)).toBeCloseTo(x, 5);
      expect(at(-x)).toBeCloseTo(-x, 5);
    }
  });

  it('単調増加で、±1 を超えない', () => {
    let prev = -Infinity;
    for (let i = 0; i < curve.length; i++) {
      expect(curve[i]!).toBeGreaterThanOrEqual(prev - 1e-9);
      expect(Math.abs(curve[i]!)).toBeLessThanOrEqual(1);
      prev = curve[i]!;
    }
  });

  it('原点対称（直流成分を作らない）', () => {
    for (const x of [0.2, 0.5, 0.8, 1]) {
      expect(at(x)).toBeCloseTo(-at(-x), 6);
    }
  });

  it('閾値の前後で傾きが連続する（折れ点による歪みが出ない）', () => {
    const h = 0.002;
    const slopeBelow = (at(threshold - h) - at(threshold - 2 * h)) / h;
    const slopeAbove = (at(threshold + 2 * h) - at(threshold + h)) / h;
    expect(slopeBelow).toBeCloseTo(1, 2);
    expect(slopeAbove).toBeCloseTo(1, 1);
  });

  it('閾値を超えると圧縮される', () => {
    expect(at(1)).toBeLessThan(1);
    expect(at(0.9)).toBeLessThan(0.9);
    expect(at(0.9)).toBeGreaterThan(threshold);
  });
});

describe('volumeToGain', () => {
  it('0 で無音、1 で 0 dB', () => {
    expect(volumeToGain(0)).toBe(0);
    expect(volumeToGain(1)).toBeCloseTo(1, 9);
  });

  it('単調増加', () => {
    let prev = -1;
    for (let v = 0; v <= 1.0001; v += 0.01) {
      const g = volumeToGain(v);
      expect(g).toBeGreaterThan(prev);
      prev = g;
    }
  });

  it('ブーストはしない（1.0 を超えない）', () => {
    expect(volumeToGain(2)).toBeLessThanOrEqual(1);
  });
});
