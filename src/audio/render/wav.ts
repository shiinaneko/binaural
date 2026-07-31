/**
 * WAV エンコーダ（SPEC.md §9）。
 *
 * 分割レンダリングと組み合わせるため、ヘッダと PCM を別々に作れる形にしてある。
 * 総フレーム数は書き出し前に確定しているので、ヘッダを先頭で作れる。
 */

import { mulberry32 } from '../prng';

export type BitDepth = 16 | 24;

const HEADER_BYTES = 44;

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) {
    view.setUint8(offset + i, text.charCodeAt(i));
  }
}

export interface WavFormat {
  sampleRate: number;
  channels: number;
  bitDepth: BitDepth;
  /** 全体のフレーム数（1 フレーム = 全チャンネル 1 サンプル） */
  totalFrames: number;
}

export function bytesPerFrame(format: Pick<WavFormat, 'channels' | 'bitDepth'>): number {
  return format.channels * (format.bitDepth / 8);
}

/** WAV 全体のバイト数（見積表示に使う） */
export function estimateWavBytes(format: WavFormat): number {
  return HEADER_BYTES + format.totalFrames * bytesPerFrame(format);
}

/** 44 バイトの正準ヘッダ（RIFF / fmt / data） */
export function createWavHeader(format: WavFormat): Uint8Array<ArrayBuffer> {
  const { sampleRate, channels, bitDepth, totalFrames } = format;
  const blockAlign = bytesPerFrame(format);
  const dataBytes = totalFrames * blockAlign;

  const buffer = new ArrayBuffer(HEADER_BYTES);
  const view = new DataView(buffer);

  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true); // これ以降のバイト数
  writeAscii(view, 8, 'WAVE');

  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // fmt チャンクの長さ
  view.setUint16(20, 1, true); // 1 = 非圧縮 PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true); // バイト毎秒
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);

  writeAscii(view, 36, 'data');
  view.setUint32(40, dataBytes, true);

  return new Uint8Array(buffer);
}

/**
 * 量子化器。TPDF ディザを掛けながら Float32 → 整数 PCM に落とす。
 *
 * 16 bit では量子化誤差が信号と相関して歪みとして聞こえるため、
 * 1 LSB 幅の三角分布ノイズ（TPDF = 一様乱数の差）を足してから丸める。
 * 24 bit は量子化ノイズが −144 dBFS 相当で可聴域に無いためディザは掛けない。
 *
 * 状態（PRNG）を保持するので、チャンクをまたいでも同じ流れのディザが続く。
 */
export class PcmQuantizer {
  private readonly bitDepth: BitDepth;
  private readonly dither: boolean;
  private readonly rand: () => number;

  constructor(bitDepth: BitDepth, seed = 0x9e3779b9) {
    this.bitDepth = bitDepth;
    this.dither = bitDepth === 16;
    this.rand = mulberry32(seed);
  }

  /**
   * チャンネル配列（各 Float32Array）をインターリーブして PCM バイト列にする。
   * @param from 開始フレーム（含む）
   * @param to 終了フレーム（含まない）
   */
  encode(
    channels: Float32Array[],
    from = 0,
    to = channels[0]?.length ?? 0,
  ): Uint8Array<ArrayBuffer> {
    const channelCount = channels.length;
    const frames = Math.max(0, to - from);
    const bytesPerSample = this.bitDepth / 8;
    const out = new Uint8Array(new ArrayBuffer(frames * channelCount * bytesPerSample));
    const view = new DataView(out.buffer);

    const peak = this.bitDepth === 16 ? 32767 : 8388607;
    const floor = this.bitDepth === 16 ? -32768 : -8388608;
    // ディザの振幅は 1 LSB 相当（正規化値に換算）
    const lsb = 1 / (peak + 1);

    let offset = 0;
    for (let frame = from; frame < to; frame++) {
      for (let ch = 0; ch < channelCount; ch++) {
        let sample = channels[ch]![frame] ?? 0;

        if (this.dither) {
          // TPDF: 一様乱数 2 つの差 → 三角分布（±1 LSB、平均 0）
          sample += (this.rand() - this.rand()) * lsb;
        }

        let quantized = Math.round(sample * (peak + 1));
        if (quantized > peak) quantized = peak;
        else if (quantized < floor) quantized = floor;

        if (this.bitDepth === 16) {
          view.setInt16(offset, quantized, true);
          offset += 2;
        } else {
          // 24 bit リトルエンディアン（3 バイト）
          view.setUint8(offset, quantized & 0xff);
          view.setUint8(offset + 1, (quantized >> 8) & 0xff);
          view.setUint8(offset + 2, (quantized >> 16) & 0xff);
          offset += 3;
        }
      }
    }

    return out;
  }
}

/** 単発の書き出し用（テストや短いプレビューに使う） */
export function encodeWav(
  channels: Float32Array[],
  sampleRate: number,
  bitDepth: BitDepth = 16,
): Blob {
  const totalFrames = channels[0]?.length ?? 0;
  const header = createWavHeader({
    sampleRate,
    channels: channels.length,
    bitDepth,
    totalFrames,
  });
  const pcm = new PcmQuantizer(bitDepth).encode(channels);
  return new Blob([header, pcm], { type: 'audio/wav' });
}
