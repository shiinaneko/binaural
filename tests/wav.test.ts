import { describe, expect, it } from 'vitest';
import {
  bytesPerFrame,
  createWavHeader,
  estimateWavBytes,
  PcmQuantizer,
} from '../src/audio/render/wav';

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.slice(offset, offset + length));
}

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

describe('createWavHeader', () => {
  const header = createWavHeader({
    sampleRate: 48000,
    channels: 2,
    bitDepth: 16,
    totalFrames: 48000 * 60,
  });

  it('44 バイト', () => {
    expect(header.length).toBe(44);
  });

  it('RIFF / WAVE / fmt / data のチャンク名', () => {
    expect(ascii(header, 0, 4)).toBe('RIFF');
    expect(ascii(header, 8, 4)).toBe('WAVE');
    expect(ascii(header, 12, 4)).toBe('fmt ');
    expect(ascii(header, 36, 4)).toBe('data');
  });

  it('fmt チャンクの中身', () => {
    const dv = view(header);
    expect(dv.getUint32(16, true)).toBe(16); // fmt の長さ
    expect(dv.getUint16(20, true)).toBe(1); // 非圧縮 PCM
    expect(dv.getUint16(22, true)).toBe(2); // チャンネル数
    expect(dv.getUint32(24, true)).toBe(48000);
    expect(dv.getUint32(28, true)).toBe(48000 * 4); // バイト毎秒
    expect(dv.getUint16(32, true)).toBe(4); // ブロックアライン
    expect(dv.getUint16(34, true)).toBe(16);
  });

  it('サイズ欄が実データと整合する', () => {
    const dv = view(header);
    const dataBytes = 48000 * 60 * 4;
    expect(dv.getUint32(40, true)).toBe(dataBytes);
    expect(dv.getUint32(4, true)).toBe(36 + dataBytes);
  });

  it('24 bit でもブロックアラインが合う', () => {
    const h24 = createWavHeader({
      sampleRate: 48000,
      channels: 2,
      bitDepth: 24,
      totalFrames: 1000,
    });
    const dv = view(h24);
    expect(dv.getUint16(32, true)).toBe(6);
    expect(dv.getUint16(34, true)).toBe(24);
    expect(dv.getUint32(40, true)).toBe(1000 * 6);
  });
});

describe('estimateWavBytes', () => {
  it('25 分 16 bit ステレオはおよそ 288 MB', () => {
    const bytes = estimateWavBytes({
      sampleRate: 48000,
      channels: 2,
      bitDepth: 16,
      totalFrames: 48000 * 1500,
    });
    expect(bytes / 1e6).toBeCloseTo(288, 0);
  });

  it('24 bit は 1.5 倍', () => {
    const base = { sampleRate: 48000, channels: 2, totalFrames: 48000 * 60 };
    const b16 = estimateWavBytes({ ...base, bitDepth: 16 });
    const b24 = estimateWavBytes({ ...base, bitDepth: 24 });
    expect((b24 - 44) / (b16 - 44)).toBeCloseTo(1.5, 6);
  });

  it('bytesPerFrame', () => {
    expect(bytesPerFrame({ channels: 2, bitDepth: 16 })).toBe(4);
    expect(bytesPerFrame({ channels: 2, bitDepth: 24 })).toBe(6);
  });
});

describe('PcmQuantizer 16 bit', () => {
  it('インターリーブされる', () => {
    const q = new PcmQuantizer(16);
    const left = new Float32Array([1, 1, 1]);
    const right = new Float32Array([-1, -1, -1]);
    const pcm = q.encode([left, right]);
    const dv = view(pcm);
    expect(pcm.length).toBe(3 * 2 * 2);
    expect(dv.getInt16(0, true)).toBe(32767); // L
    expect(dv.getInt16(2, true)).toBe(-32768); // R
  });

  it('範囲外をクリップする（オーバーフローで折り返さない）', () => {
    const q = new PcmQuantizer(16);
    const pcm = q.encode([new Float32Array([5, -5])]);
    const dv = view(pcm);
    expect(dv.getInt16(0, true)).toBe(32767);
    expect(dv.getInt16(2, true)).toBe(-32768);
  });

  it('区間指定で切り出せる（分割書き出し用）', () => {
    const q = new PcmQuantizer(24);
    const data = new Float32Array([0, 0.5, -0.5, 0]);
    expect(q.encode([data], 1, 3).length).toBe(2 * 3);
  });

  it('ディザは直流成分を持たない（平均 0）', () => {
    const q = new PcmQuantizer(16);
    const n = 20000;
    // 量子化格子のちょうど中間に置き、ディザだけが出力を決める状況にする
    const level = 0.5 / 32768;
    const pcm = q.encode([new Float32Array(n).fill(level)]);
    const dv = view(pcm);
    let sum = 0;
    for (let i = 0; i < n; i++) sum += dv.getInt16(i * 2, true);
    // 平均は 0.5 LSB 付近（丸めの期待値）で、偏りが小さいこと
    const mean = sum / n;
    expect(mean).toBeGreaterThan(0.3);
    expect(mean).toBeLessThan(0.7);
  });

  it('ディザは左右で相関しない（ステレオ像を汚さない）', () => {
    const q = new PcmQuantizer(16);
    const n = 20000;
    const silence = new Float32Array(n);
    const pcm = q.encode([silence, silence]);
    const dv = view(pcm);
    let sumL = 0, sumR = 0, sumLR = 0, sumL2 = 0, sumR2 = 0;
    for (let i = 0; i < n; i++) {
      const l = dv.getInt16(i * 4, true);
      const r = dv.getInt16(i * 4 + 2, true);
      sumL += l; sumR += r; sumLR += l * r; sumL2 += l * l; sumR2 += r * r;
    }
    const cov = sumLR / n - (sumL / n) * (sumR / n);
    const corr = cov / Math.sqrt((sumL2 / n) * (sumR2 / n));
    expect(Math.abs(corr)).toBeLessThan(0.1);
  });

  it('同じシードなら同じディザ（書き出しの再現性）', () => {
    const data = new Float32Array(1000).fill(0.25 / 32768);
    const a = new PcmQuantizer(16, 42).encode([data]);
    const b = new PcmQuantizer(16, 42).encode([data]);
    expect(Array.from(a)).toEqual(Array.from(b));
  });
});

describe('PcmQuantizer 24 bit', () => {
  it('3 バイトリトルエンディアン', () => {
    const q = new PcmQuantizer(24);
    const pcm = q.encode([new Float32Array([1, -1, 0])]);
    expect(pcm.length).toBe(9);
    // +1.0 → 8388607 = 0x7FFFFF
    expect([pcm[0], pcm[1], pcm[2]]).toEqual([0xff, 0xff, 0x7f]);
    // −1.0 → −8388608 = 0x800000
    expect([pcm[3], pcm[4], pcm[5]]).toEqual([0x00, 0x00, 0x80]);
    expect([pcm[6], pcm[7], pcm[8]]).toEqual([0, 0, 0]);
  });

  it('ディザを掛けない（無音は完全な無音のまま）', () => {
    const q = new PcmQuantizer(24);
    const pcm = q.encode([new Float32Array(500)]);
    expect(pcm.every((b) => b === 0)).toBe(true);
  });

  it('往復して元の値に戻る（量子化誤差の範囲で）', () => {
    const q = new PcmQuantizer(24);
    const values = new Float32Array([0.1, -0.25, 0.5, -0.75, 0.9]);
    const pcm = q.encode([values]);
    for (let i = 0; i < values.length; i++) {
      const b0 = pcm[i * 3]!, b1 = pcm[i * 3 + 1]!, b2 = pcm[i * 3 + 2]!;
      let quantized = b0 | (b1 << 8) | (b2 << 16);
      if (quantized & 0x800000) quantized -= 0x1000000;
      expect(quantized / 8388608).toBeCloseTo(values[i]!, 6);
    }
  });
});
