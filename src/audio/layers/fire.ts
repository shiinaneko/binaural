/**
 * 焚き火レイヤー（SPEC.md §3.3）。
 *
 * ①低域ベッド：ローパス 200 Hz のブラウンノイズ（燃える音の芯）
 * ②パチパチ粒：1–3 ms の極短い破裂音、ハイパス 1.5 kHz、Poisson 過程で毎秒 7 粒
 *
 * 焚き火の粒は雨と違って**まとまって鳴る**（一度弾けると連鎖する）。
 * 通し番号からバースト性を作り、単調な等間隔にならないようにしている。
 */

import { applyBandpass, normalizePeak } from '../dsp';
import { GrainScheduler } from '../GrainScheduler';
import { mulberry32 } from '../prng';
import { LayerBase } from './base';
import { GrainBaker, mixGrain } from './grainBaker';
import { createNoiseBuffer } from './noise';

/** 基本レート。バーストのぶんを見込んで少し高めに取り、粒側で間引く */
const GRAINS_PER_SEC = 14;
const BLOCK_SEC = 15;

const BED_GAIN = 1.0;
const GRAIN_GAIN = 1.0;
const INTERNAL_TRIM = 1.124;

/** パチパチの素を作る。極短く、高域寄り。 */
function createCrackles(ctx: BaseAudioContext, seed: number, count = 20): Float32Array[] {
  const sr = ctx.sampleRate;
  const rand = mulberry32(seed);
  const crackles: Float32Array[] = [];

  for (let n = 0; n < count; n++) {
    const durationSec = 0.001 + rand() * 0.004; // 1–5 ms
    const centerHz = 1500 + rand() * 4500;
    const q = 0.8 + rand() * 1.6;
    const peak = 0.2 + rand() * 0.8;

    const length = Math.max(6, Math.floor(durationSec * sr));
    const data = new Float32Array(length);
    // 立ち上がりが鋭く、すぐ消える
    const tau = length / 6;
    for (let i = 0; i < length; i++) {
      data[i] = (rand() * 2 - 1) * Math.exp(-i / tau) * (i < 2 ? i / 2 : 1);
    }
    applyBandpass(data, sr, centerHz, q);
    normalizePeak(data, peak);
    crackles.push(data);
  }

  return crackles;
}

export class FireLayer extends LayerBase {
  private readonly bedSource: AudioBufferSourceNode;
  private readonly grainBus: GainNode;
  private readonly crackles: Float32Array[];
  private readonly baker: GrainBaker;
  private readonly paramSeed: number;
  private readonly nodes: AudioNode[] = [];
  private readonly alignSec: number;

  constructor(ctx: BaseAudioContext, seed: number, alignSec = 0) {
    super(ctx, 'fire');
    this.alignSec = alignSec;
    this.crackles = createCrackles(ctx, seed);
    this.paramSeed = (seed ^ 0x2b7e1516) >>> 0;

    // ① 低域ベッド
    this.bedSource = ctx.createBufferSource();
    this.bedSource.buffer = createNoiseBuffer(ctx, 'brown', seed);
    this.bedSource.loop = true;
    const bedLp = ctx.createBiquadFilter();
    bedLp.type = 'lowpass';
    bedLp.frequency.value = 200;
    bedLp.Q.value = 0.7;
    const bedGain = ctx.createGain();
    bedGain.gain.value = BED_GAIN * INTERNAL_TRIM;
    this.bedSource.connect(bedLp).connect(bedGain).connect(this.output);
    this.nodes.push(bedLp, bedGain);

    // ② パチパチ
    this.grainBus = ctx.createGain();
    this.grainBus.gain.value = GRAIN_GAIN * INTERNAL_TRIM;
    this.grainBus.connect(this.output);

    this.baker = new GrainBaker({
      ctx,
      destination: this.grainBus,
      scheduler: new GrainScheduler(mulberry32((seed ^ 0x3c6ef372) >>> 0), GRAINS_PER_SEC),
      blockSec: BLOCK_SEC,
      writeGrain: (left, right, startSample, index) => {
        const rand = mulberry32((this.paramSeed + index * 0x9e3779b1) >>> 0);
        rand();
        const pick = rand();
        // 粒の 4 割は鳴らさない。残りがまとまって聞こえ、間欠的な焚き火らしさが出る
        if (pick < 0.4) return;

        const source = this.crackles[Math.floor(rand() * this.crackles.length)]!;
        const pan = rand() * 1.2 - 0.6;
        const rate = 0.8 + rand() * 0.6;
        mixGrain(left, right, source, startSample, rate, pan, 1);

        // 一定の割合で、直後にもう 1〜2 粒続けて弾く（連鎖するパチパチ）
        if (rand() < 0.35) {
          const extra = 1 + Math.floor(rand() * 2);
          for (let k = 0; k < extra; k++) {
            const delay = Math.floor((0.01 + rand() * 0.05) * left.length) % (left.length / 4);
            const follower = this.crackles[Math.floor(rand() * this.crackles.length)]!;
            mixGrain(
              left,
              right,
              follower,
              startSample + delay,
              0.8 + rand() * 0.6,
              pan + (rand() - 0.5) * 0.3,
              0.7,
            );
          }
        }
      },
    });
  }

  start(when: number): void {
    if (this.started) return;
    this.started = true;
    const duration = this.bedSource.buffer?.duration ?? 10;
    this.bedSource.start(when, ((this.alignSec % duration) + duration) % duration);
    this.baker.start(when, this.alignSec);
  }

  stop(when: number): void {
    if (!this.started || this.stopped) return;
    this.stopped = true;
    this.bedSource.stop(when);
    this.baker.stop(when);
  }

  pump(untilTime: number): void {
    this.baker.pump(untilTime);
  }

  dispose(): void {
    this.baker.dispose();
    this.disconnectAll([this.bedSource, ...this.nodes, this.grainBus, this.output]);
  }
}
