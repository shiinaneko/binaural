import { describe, expect, it } from 'vitest';
import { createImpulseResponse } from '../src/audio/reverb';
import { fakeContext } from './fakeAudio';

const sr = 48000;

function channel(buffer: AudioBuffer, ch: number): Float32Array {
  return buffer.getChannelData(ch);
}

function energy(data: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < data.length; i++) sum += data[i]! * data[i]!;
  return sum;
}

function rmsRange(data: Float32Array, from: number, to: number): number {
  let sum = 0;
  for (let i = from; i < to; i++) sum += data[i]! * data[i]!;
  return Math.sqrt(sum / (to - from));
}

describe('createImpulseResponse', () => {
  const ir = createImpulseResponse(fakeContext(sr), { decaySec: 2.0, seed: 1234 });

  it('減衰時間ぶんの長さを持つ', () => {
    expect(ir.numberOfChannels).toBe(2);
    // decaySec + preDelay
    expect(ir.length).toBeGreaterThan(2.0 * sr);
    expect(ir.length).toBeLessThan(2.1 * sr);
  });

  it('sum(h²) = 1 に正規化されている（減衰時間を変えても音量が変わらない）', () => {
    expect(energy(channel(ir, 0))).toBeCloseTo(1, 6);
    expect(energy(channel(ir, 1))).toBeCloseTo(1, 6);
  });

  it('減衰時間を変えてもエネルギーは 1 のまま', () => {
    for (const decaySec of [1.0, 2.6, 4.0]) {
      const other = createImpulseResponse(fakeContext(sr), { decaySec, seed: 7 });
      expect(energy(channel(other, 0))).toBeCloseTo(1, 6);
    }
  });

  it('時間とともに単調に減衰する', () => {
    const data = channel(ir, 0);
    const windows = [0.1, 0.5, 1.0, 1.5].map((t) =>
      rmsRange(data, Math.floor(t * sr), Math.floor((t + 0.05) * sr)),
    );
    for (let i = 1; i < windows.length; i++) {
      expect(windows[i]!).toBeLessThan(windows[i - 1]!);
    }
  });

  it('末尾はほぼ無音まで落ちている（−60 dB 相当）', () => {
    const data = channel(ir, 0);
    const head = rmsRange(data, Math.floor(0.02 * sr), Math.floor(0.07 * sr));
    const tail = rmsRange(data, data.length - Math.floor(0.05 * sr), data.length);
    expect(20 * Math.log10(tail / head)).toBeLessThan(-50);
  });

  it('プリディレイぶん先頭が無音', () => {
    const data = channel(ir, 0);
    // 既定 12 ms
    for (let i = 0; i < Math.floor(0.01 * sr); i++) {
      expect(data[i]).toBe(0);
    }
  });

  it('立ち上がりにフェードインがある（頭のクリックを避ける）', () => {
    const data = channel(ir, 0);
    const preDelay = Math.floor(0.012 * sr);
    const first = rmsRange(data, preDelay, preDelay + 20);
    const later = rmsRange(data, preDelay + 400, preDelay + 420);
    expect(first).toBeLessThan(later);
  });

  it('左右が非相関（ステレオの広がりを作る）', () => {
    const a = channel(ir, 0);
    const b = channel(ir, 1);
    let ab = 0;
    for (let i = 0; i < a.length; i++) ab += a[i]! * b[i]!;
    // energy が 1 に正規化済みなので、内積そのものが相関係数
    expect(Math.abs(ab)).toBeLessThan(0.05);
  });

  it('同じシードなら同じ IR になる', () => {
    const a = createImpulseResponse(fakeContext(sr), { decaySec: 2.0, seed: 42 });
    const b = createImpulseResponse(fakeContext(sr), { decaySec: 2.0, seed: 42 });
    expect(Array.from(channel(a, 0).slice(0, 2000))).toEqual(
      Array.from(channel(b, 0).slice(0, 2000)),
    );
  });
});
