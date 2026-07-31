/**
 * ノイズ系レイヤー（SPEC.md §3.3）。
 *
 * ホワイトノイズをシード付き PRNG で生成し、フィルタで色付けして AudioBuffer に焼く。
 * 10 秒のループだが、末尾と先頭を等パワークロスフェードしてあるため継ぎ目は聞こえない。
 * ScriptProcessorNode は使わない（非推奨かつメインスレッドを塞ぐ）。
 */

import { mulberry32 } from '../prng';
import type { AmbienceId } from '../types';
import { LayerBase } from './base';

export type NoiseColor = 'white' | 'pink' | 'brown';

const BUFFER_SEC = 10;
const CROSSFADE_SEC = 0.5;

/** Paul Kellet の 7 極近似。−3 dB/oct のピンクノイズ。 */
function makePinkGenerator(rand: () => number): () => number {
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  let b3 = 0;
  let b4 = 0;
  let b5 = 0;
  let b6 = 0;
  return () => {
    const white = rand() * 2 - 1;
    b0 = 0.99886 * b0 + white * 0.0555179;
    b1 = 0.99332 * b1 + white * 0.0750759;
    b2 = 0.969 * b2 + white * 0.153852;
    b3 = 0.8665 * b3 + white * 0.3104856;
    b4 = 0.55 * b4 + white * 0.5329522;
    b5 = -0.7616 * b5 - white * 0.016898;
    const pink = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
    b6 = white * 0.115926;
    return pink * 0.11;
  };
}

/** 漏れ積分による −6 dB/oct のブラウンノイズ。 */
function makeBrownGenerator(rand: () => number): () => number {
  let last = 0;
  return () => {
    const white = rand() * 2 - 1;
    last = (last + 0.02 * white) / 1.02;
    return last * 3.5;
  };
}

function generatorFor(color: NoiseColor, rand: () => number): () => number {
  switch (color) {
    case 'white':
      return () => rand() * 2 - 1;
    case 'pink':
      return makePinkGenerator(rand);
    case 'brown':
      return makeBrownGenerator(rand);
  }
}

/**
 * ループ用のノイズバッファを作る。左右は独立に生成して非相関にし、
 * 広がりのある落ち着いたベッドにする（環境音バスなので位相は問題にならない）。
 */
export function createNoiseBuffer(
  ctx: BaseAudioContext,
  color: NoiseColor,
  seed: number,
  seconds = BUFFER_SEC,
): AudioBuffer {
  const sr = ctx.sampleRate;
  const xf = Math.floor(CROSSFADE_SEC * sr);
  const length = Math.floor(seconds * sr);
  const buffer = ctx.createBuffer(2, length, sr);

  for (let ch = 0; ch < 2; ch++) {
    // 生成長は length + xf。末尾 xf を先頭に折り返して継ぎ目を消す。
    const gen = generatorFor(color, mulberry32(seed + ch * 0x9e3779b9));
    const raw = new Float32Array(length + xf);
    // 先頭のフィルタ過渡応答を捨てるため空回しする
    for (let i = 0; i < sr; i++) gen();
    for (let i = 0; i < raw.length; i++) raw[i] = gen();

    const out = buffer.getChannelData(ch);
    out.set(raw.subarray(0, length));
    for (let i = 0; i < xf; i++) {
      const u = i / xf;
      // 等パワークロスフェード（非相関ノイズでは振幅ではなくパワーを揃える）
      const fadeIn = Math.sqrt(u);
      const fadeOut = Math.sqrt(1 - u);
      out[i] = raw[i] * fadeIn + raw[length + i] * fadeOut;
    }

    // RMS 正規化。ピーク基準にすると、波高率の違い（ブラウンは尖る）でノイズの色ごとに
    // 体感音量がずれる。RMS を 1.0 に揃えておけば LAYER_REFERENCE_DB がそのまま
    // 出力 RMS を意味するようになり、搬送波とのバランスを dB で設計できる。
    let energy = 0;
    for (let i = 0; i < length; i++) energy += out[i] * out[i];
    const rms = Math.sqrt(energy / length);
    if (rms > 0) {
      const norm = 1 / rms;
      for (let i = 0; i < length; i++) out[i] = out[i] * norm;
    }
  }

  return buffer;
}

export interface NoiseLayerOptions {
  id: AmbienceId;
  color: NoiseColor;
  seed: number;
  /** ローパスのカットオフ（Hz）。省略時はローパスなし */
  lowpassHz?: number;
  /** ハイパスのカットオフ（Hz）。省略時はハイパスなし */
  highpassHz?: number;
  /** 分割レンダリング用。ループ位置をこの絶対時刻に合わせる */
  alignSec?: number;
}

export class NoiseLayer extends LayerBase {
  private readonly source: AudioBufferSourceNode;
  private readonly nodes: AudioNode[] = [];
  private readonly alignSec: number;

  constructor(ctx: BaseAudioContext, opts: NoiseLayerOptions) {
    super(ctx, opts.id, -24);
    this.alignSec = opts.alignSec ?? 0;

    this.source = ctx.createBufferSource();
    this.source.buffer = createNoiseBuffer(ctx, opts.color, opts.seed);
    this.source.loop = true;

    let tail: AudioNode = this.source;
    if (opts.highpassHz !== undefined) {
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = opts.highpassHz;
      hp.Q.value = 0.7;
      tail = tail.connect(hp);
      this.nodes.push(hp);
    }
    if (opts.lowpassHz !== undefined) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = opts.lowpassHz;
      lp.Q.value = 0.7;
      tail = tail.connect(lp);
      this.nodes.push(lp);
    }

    tail.connect(this.output);
  }

  start(when: number): void {
    if (this.started) return;
    this.started = true;
    // 絶対時刻に対応するループ位置から始める（分割レンダリングの境界を一致させる）
    const duration = this.source.buffer?.duration ?? BUFFER_SEC;
    const offset = ((this.alignSec % duration) + duration) % duration;
    this.source.start(when, offset);
  }

  stop(when: number): void {
    if (!this.started || this.stopped) return;
    this.stopped = true;
    this.source.stop(when);
  }

  dispose(): void {
    this.disconnectAll([this.source, ...this.nodes, this.output]);
  }
}
