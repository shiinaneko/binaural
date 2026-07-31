/**
 * 雨レイヤー（SPEC.md §3.3）。
 *
 * 3 層構造:
 *   ①低域ベッド  ブラウンノイズ + ローパス 400 Hz（遠くの雨音の芯）
 *   ②本体        ピンクノイズ + バンドパス 500–6000 Hz（面としての雨）
 *   ③滴の粒      短い帯域ノイズバースト、Poisson 過程で毎秒 25 粒
 *
 * 粒はフィルタと減衰まで JS 側で焼いたバッファを 16 個プリベイクして使い回し、
 * さらにブロック単位でまとめて 1 本のバッファに書き込む（GrainBaker）。
 */

import { applyBandpass, normalizePeak } from '../dsp';
import { GrainScheduler } from '../GrainScheduler';
import { mulberry32 } from '../prng';
import { LayerBase } from './base';
import { GrainBaker, mixGrain } from './grainBaker';
import { createNoiseBuffer } from './noise';

const GRAINS_PER_SEC = 25;
const BLOCK_SEC = 15;

/**
 * 層の相対バランス。INTERNAL_TRIM は「level=1 での出力 RMS が
 * LAYER_REFERENCE_DB と一致する」ようにオフラインレンダリングの実測で校正した値。
 * 層の構成やフィルタを変えたら測り直すこと。
 */
const BED_GAIN = 1.6;
const BODY_GAIN = 1.0;
const GRAIN_GAIN = 0.5;
const INTERNAL_TRIM = 0.596;

/**
 * 滴のバッファをプリベイクする。
 * 長さ・中心周波数・ピークをばらして 16 種類作り、発音ごとに選ぶ。
 */
function createDroplets(ctx: BaseAudioContext, seed: number, count = 16): Float32Array[] {
  const sr = ctx.sampleRate;
  const rand = mulberry32(seed);
  const droplets: Float32Array[] = [];

  for (let n = 0; n < count; n++) {
    const durationSec = 0.003 + rand() * 0.011; // 3–14 ms
    const centerHz = 1500 + rand() * 7500; // 1.5–9 kHz
    const q = 1.2 + rand() * 2.3;
    const peak = 0.35 + rand() * 0.65;

    const length = Math.max(8, Math.floor(durationSec * sr));
    const data = new Float32Array(length);
    const tau = length / 4;
    const attack = Math.max(2, Math.floor(0.0004 * sr));
    for (let i = 0; i < length; i++) {
      data[i] = (rand() * 2 - 1) * Math.exp(-i / tau) * (i < attack ? i / attack : 1);
    }

    applyBandpass(data, sr, centerHz, q);
    normalizePeak(data, peak);
    droplets.push(data);
  }

  return droplets;
}

export class RainLayer extends LayerBase {
  private readonly bedSource: AudioBufferSourceNode;
  private readonly bodySource: AudioBufferSourceNode;
  private readonly grainBus: GainNode;
  private readonly droplets: Float32Array[];
  private readonly baker: GrainBaker;
  private readonly paramSeed: number;
  private readonly nodes: AudioNode[] = [];
  private readonly alignSec: number;

  /** @param alignSec 分割レンダリング用。粒の並びとループ位置をこの絶対時刻に合わせる */
  constructor(ctx: BaseAudioContext, seed: number, alignSec = 0) {
    super(ctx, 'rain');
    this.alignSec = alignSec;
    this.droplets = createDroplets(ctx, seed);
    this.paramSeed = (seed ^ 0x1f2e3d4c) >>> 0;

    // ① 低域ベッド
    this.bedSource = ctx.createBufferSource();
    this.bedSource.buffer = createNoiseBuffer(ctx, 'brown', seed);
    this.bedSource.loop = true;
    const bedLp = ctx.createBiquadFilter();
    bedLp.type = 'lowpass';
    bedLp.frequency.value = 400;
    bedLp.Q.value = 0.7;
    const bedGain = ctx.createGain();
    bedGain.gain.value = BED_GAIN * INTERNAL_TRIM;
    this.bedSource.connect(bedLp).connect(bedGain).connect(this.output);
    this.nodes.push(bedLp, bedGain);

    // ② 本体
    this.bodySource = ctx.createBufferSource();
    this.bodySource.buffer = createNoiseBuffer(ctx, 'pink', (seed + 0x51ed270b) >>> 0);
    this.bodySource.loop = true;
    const bodyHp = ctx.createBiquadFilter();
    bodyHp.type = 'highpass';
    bodyHp.frequency.value = 500;
    bodyHp.Q.value = 0.7;
    const bodyLp = ctx.createBiquadFilter();
    bodyLp.type = 'lowpass';
    bodyLp.frequency.value = 6000;
    bodyLp.Q.value = 0.7;
    const bodyGain = ctx.createGain();
    bodyGain.gain.value = BODY_GAIN * INTERNAL_TRIM;
    this.bodySource.connect(bodyHp).connect(bodyLp).connect(bodyGain).connect(this.output);
    this.nodes.push(bodyHp, bodyLp, bodyGain);

    // ③ 粒
    this.grainBus = ctx.createGain();
    this.grainBus.gain.value = GRAIN_GAIN * INTERNAL_TRIM;
    this.grainBus.connect(this.output);

    this.baker = new GrainBaker({
      ctx,
      destination: this.grainBus,
      scheduler: new GrainScheduler(mulberry32((seed ^ 0x7a3b1c9d) >>> 0), GRAINS_PER_SEC),
      blockSec: BLOCK_SEC,
      writeGrain: (left, right, startSample, index) => {
        const rand = mulberry32((this.paramSeed + index * 0x9e3779b1) >>> 0);
        rand(); // 初回は種の偏りが残るので捨てる
        const source = this.droplets[Math.floor(rand() * this.droplets.length)]!;
        mixGrain(left, right, source, startSample, 0.85 + rand() * 0.4, rand() * 1.7 - 0.85, 1);
      },
    });
  }

  start(when: number): void {
    if (this.started) return;
    this.started = true;

    const bedDuration = this.bedSource.buffer?.duration ?? 10;
    const bodyDuration = this.bodySource.buffer?.duration ?? 10;
    this.bedSource.start(when, ((this.alignSec % bedDuration) + bedDuration) % bedDuration);
    this.bodySource.start(when, ((this.alignSec % bodyDuration) + bodyDuration) % bodyDuration);
    this.baker.start(when, this.alignSec);
  }

  stop(when: number): void {
    if (!this.started || this.stopped) return;
    this.stopped = true;
    this.bedSource.stop(when);
    this.bodySource.stop(when);
    this.baker.stop(when);
  }

  pump(untilTime: number): void {
    this.baker.pump(untilTime);
  }

  dispose(): void {
    this.baker.dispose();
    this.disconnectAll([this.bedSource, this.bodySource, ...this.nodes, this.grainBus, this.output]);
  }
}
