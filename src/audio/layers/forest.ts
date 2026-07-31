/**
 * 森と小川レイヤー（SPEC.md §3.3）。
 *
 * ①小川：バンドパス 600–3000 Hz のノイズ + 水面の微細な粒
 * ②葉擦れ：ハイパス 4 kHz のノイズを 0.1 Hz でごく緩く揺らす
 *
 * 鳥の声（FM チャープ）は仕様では「既定オフ」の任意要素。突発的な音は集中を
 * 削ぐ側に働きやすいので、この実装では入れていない。
 */

import { applyBandpass, normalizePeak } from '../dsp';
import { GrainScheduler } from '../GrainScheduler';
import { wrapPhase } from '../phase';
import { mulberry32 } from '../prng';
import { createSineWave } from '../waveform';
import { LayerBase } from './base';
import { GrainBaker, mixGrain } from './grainBaker';
import { createNoiseBuffer } from './noise';

const GRAINS_PER_SEC = 40;
const BLOCK_SEC = 15;
const LEAF_LFO_HZ = 0.1;

const STREAM_GAIN = 1.0;
const LEAF_GAIN = 0.55;
const GRAIN_GAIN = 0.35;
const INTERNAL_TRIM = 1.598;

/** 水面が跳ねる微細な粒。雨より短く、中域寄りで柔らかい。 */
function createRipples(ctx: BaseAudioContext, seed: number, count = 14): Float32Array[] {
  const sr = ctx.sampleRate;
  const rand = mulberry32(seed);
  const ripples: Float32Array[] = [];

  for (let n = 0; n < count; n++) {
    const durationSec = 0.004 + rand() * 0.008;
    const centerHz = 900 + rand() * 2600;
    const q = 2.0 + rand() * 3.0;
    const length = Math.max(8, Math.floor(durationSec * sr));
    const data = new Float32Array(length);
    const tau = length / 3.5;
    const attack = Math.max(3, Math.floor(0.0006 * sr));
    for (let i = 0; i < length; i++) {
      data[i] = (rand() * 2 - 1) * Math.exp(-i / tau) * (i < attack ? i / attack : 1);
    }
    applyBandpass(data, sr, centerHz, q);
    normalizePeak(data, 0.25 + rand() * 0.45);
    ripples.push(data);
  }

  return ripples;
}

export class ForestLayer extends LayerBase {
  private readonly streamSource: AudioBufferSourceNode;
  private readonly leafSource: AudioBufferSourceNode;
  private readonly grainBus: GainNode;
  private readonly ripples: Float32Array[];
  private readonly baker: GrainBaker;
  private readonly paramSeed: number;
  private readonly lfo: OscillatorNode;
  private readonly nodes: AudioNode[] = [];
  private readonly alignSec: number;

  constructor(ctx: BaseAudioContext, seed: number, alignSec = 0) {
    super(ctx, 'forest');
    this.alignSec = alignSec;
    this.ripples = createRipples(ctx, seed);
    this.paramSeed = (seed ^ 0x6a09e667) >>> 0;

    // ① 小川
    this.streamSource = ctx.createBufferSource();
    this.streamSource.buffer = createNoiseBuffer(ctx, 'pink', seed);
    this.streamSource.loop = true;
    const streamHp = ctx.createBiquadFilter();
    streamHp.type = 'highpass';
    streamHp.frequency.value = 600;
    streamHp.Q.value = 0.7;
    const streamLp = ctx.createBiquadFilter();
    streamLp.type = 'lowpass';
    streamLp.frequency.value = 3000;
    streamLp.Q.value = 0.7;
    const streamGain = ctx.createGain();
    streamGain.gain.value = STREAM_GAIN * INTERNAL_TRIM;
    this.streamSource
      .connect(streamHp)
      .connect(streamLp)
      .connect(streamGain)
      .connect(this.output);
    this.nodes.push(streamHp, streamLp, streamGain);

    // ② 葉擦れ（0.1 Hz でゆっくり強弱がつく）
    this.leafSource = ctx.createBufferSource();
    this.leafSource.buffer = createNoiseBuffer(ctx, 'pink', (seed + 0xbb67ae85) >>> 0);
    this.leafSource.loop = true;
    const leafHp = ctx.createBiquadFilter();
    leafHp.type = 'highpass';
    leafHp.frequency.value = 4000;
    leafHp.Q.value = 0.7;
    const leafGain = ctx.createGain();
    leafGain.gain.value = LEAF_GAIN * INTERNAL_TRIM * 0.7;
    this.leafSource.connect(leafHp).connect(leafGain).connect(this.output);
    this.nodes.push(leafHp, leafGain);

    this.lfo = ctx.createOscillator();
    if (alignSec !== 0) {
      this.lfo.setPeriodicWave(
        createSineWave(ctx, wrapPhase(2 * Math.PI * LEAF_LFO_HZ * alignSec)),
      );
    } else {
      this.lfo.type = 'sine';
    }
    this.lfo.frequency.value = LEAF_LFO_HZ;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = LEAF_GAIN * INTERNAL_TRIM * 0.3;
    this.lfo.connect(lfoDepth).connect(leafGain.gain);
    this.nodes.push(lfoDepth);

    // ③ 水面の粒
    this.grainBus = ctx.createGain();
    this.grainBus.gain.value = GRAIN_GAIN * INTERNAL_TRIM;
    this.grainBus.connect(this.output);

    this.baker = new GrainBaker({
      ctx,
      destination: this.grainBus,
      scheduler: new GrainScheduler(mulberry32((seed ^ 0x510e527f) >>> 0), GRAINS_PER_SEC),
      blockSec: BLOCK_SEC,
      writeGrain: (left, right, startSample, index) => {
        const rand = mulberry32((this.paramSeed + index * 0x9e3779b1) >>> 0);
        rand();
        const source = this.ripples[Math.floor(rand() * this.ripples.length)]!;
        mixGrain(left, right, source, startSample, 0.9 + rand() * 0.3, rand() * 1.5 - 0.75, 1);
      },
    });
  }

  start(when: number): void {
    if (this.started) return;
    this.started = true;
    const offset = (duration: number) => ((this.alignSec % duration) + duration) % duration;
    this.streamSource.start(when, offset(this.streamSource.buffer?.duration ?? 10));
    this.leafSource.start(when, offset(this.leafSource.buffer?.duration ?? 10));
    this.lfo.start(when);
    this.baker.start(when, this.alignSec);
  }

  stop(when: number): void {
    if (!this.started || this.stopped) return;
    this.stopped = true;
    this.streamSource.stop(when);
    this.leafSource.stop(when);
    this.lfo.stop(when);
    this.baker.stop(when);
  }

  pump(untilTime: number): void {
    this.baker.pump(untilTime);
  }

  dispose(): void {
    this.baker.dispose();
    this.disconnectAll([
      this.streamSource,
      this.leafSource,
      this.lfo,
      ...this.nodes,
      this.grainBus,
      this.output,
    ]);
  }
}
