/**
 * 深く沈むドローンレイヤー（SPEC.md §3.3）。
 *
 * ①低域のサイン波（fc の 0.25 倍）
 * ②共振フィルタ（Q=8）を通したノイズ 2 本（fc の 0.5 / 0.75 倍）
 * ③カットオフを 120 秒周期でごく緩慢にスイープ
 *
 * 搬送波との干渉について:
 * - サイン波は倍音を持たないので、fc から離れていれば干渉しない（0.25fc）。
 * - 共振ノイズは fc より下に置き、Q=8 の裾が 1.0fc に届く頃には十分減衰している。
 */

import { wrapPhase } from '../phase';
import { createSineWave } from '../waveform';
import { LayerBase } from './base';
import { createNoiseBuffer } from './noise';

/** 低域サインの音高（搬送波に対する比） */
const SINE_RATIO = 0.25;
/** 共振ノイズの中心（同上） */
const RESONATOR_RATIOS = [0.5, 0.75];
const RESONATOR_Q = 8;
/** スイープの周期（秒）と深さ（中心周波数に対する比） */
const SWEEP_PERIOD_SEC = 120;
const SWEEP_DEPTH = 0.2;

const SINE_GAIN = 0.5;
const NOISE_GAIN = 1.0;
const INTERNAL_TRIM = 2.56;
const GLIDE_SEC = 2.0;

export class DroneLayer extends LayerBase {
  private readonly sine: OscillatorNode;
  private readonly noiseSource: AudioBufferSourceNode;
  private readonly resonators: BiquadFilterNode[] = [];
  private readonly sweep: OscillatorNode;
  private readonly nodes: AudioNode[] = [];
  private readonly alignSec: number;
  private tonalCenterHz: number;

  constructor(
    ctx: BaseAudioContext,
    seed: number,
    carrierHz = 240,
    alignSec = 0,
    tonalPhase = 0,
  ) {
    super(ctx, 'drone');
    this.alignSec = alignSec;
    this.tonalCenterHz = carrierHz;

    const trim = ctx.createGain();
    trim.gain.value = INTERNAL_TRIM;
    trim.connect(this.output);
    this.nodes.push(trim);

    // ① 低域サイン。分割レンダリングでは累積位相を掛けて始める
    this.sine = ctx.createOscillator();
    this.sine.setPeriodicWave(createSineWave(ctx, wrapPhase(tonalPhase * SINE_RATIO)));
    this.sine.frequency.value = carrierHz * SINE_RATIO;
    const sineGain = ctx.createGain();
    sineGain.gain.value = SINE_GAIN;
    this.sine.connect(sineGain).connect(trim);
    this.nodes.push(sineGain);

    // ② 共振ノイズ
    this.noiseSource = ctx.createBufferSource();
    this.noiseSource.buffer = createNoiseBuffer(ctx, 'brown', seed);
    this.noiseSource.loop = true;

    const noiseGain = ctx.createGain();
    noiseGain.gain.value = NOISE_GAIN / RESONATOR_RATIOS.length;
    noiseGain.connect(trim);
    this.nodes.push(noiseGain);

    // ③ スイープ用 LFO
    this.sweep = ctx.createOscillator();
    const sweepHz = 1 / SWEEP_PERIOD_SEC;
    if (alignSec !== 0) {
      this.sweep.setPeriodicWave(
        createSineWave(ctx, wrapPhase(2 * Math.PI * sweepHz * alignSec)),
      );
    } else {
      this.sweep.type = 'sine';
    }
    this.sweep.frequency.value = sweepHz;

    for (const ratio of RESONATOR_RATIOS) {
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = carrierHz * ratio;
      filter.Q.value = RESONATOR_Q;
      this.noiseSource.connect(filter).connect(noiseGain);
      this.resonators.push(filter);

      const depth = ctx.createGain();
      depth.gain.value = carrierHz * ratio * SWEEP_DEPTH;
      this.sweep.connect(depth).connect(filter.frequency);
      this.nodes.push(depth);
    }
  }

  start(when: number): void {
    if (this.started) return;
    this.started = true;
    const duration = this.noiseSource.buffer?.duration ?? 10;
    this.noiseSource.start(when, ((this.alignSec % duration) + duration) % duration);
    this.sine.start(when);
    this.sweep.start(when);
  }

  stop(when: number): void {
    if (!this.started || this.stopped) return;
    this.stopped = true;
    this.noiseSource.stop(when);
    this.sine.stop(when);
    this.sweep.stop(when);
  }

  setTonalCenterHz(carrierHz: number, when = this.ctx.currentTime): void {
    if (carrierHz === this.tonalCenterHz) return;
    this.tonalCenterHz = carrierHz;
    const now = Math.max(when, this.ctx.currentTime);

    const glide = (param: AudioParam, target: number) => {
      if (typeof param.cancelAndHoldAtTime === 'function') param.cancelAndHoldAtTime(now);
      else {
        param.cancelScheduledValues(now);
        param.setValueAtTime(param.value, now);
      }
      param.linearRampToValueAtTime(target, now + GLIDE_SEC);
    };

    glide(this.sine.frequency, carrierHz * SINE_RATIO);
    this.resonators.forEach((filter, index) => {
      glide(filter.frequency, carrierHz * RESONATOR_RATIOS[index]!);
    });
  }

  dispose(): void {
    this.disconnectAll([
      this.sine,
      this.noiseSource,
      this.sweep,
      ...this.resonators,
      ...this.nodes,
      this.output,
    ]);
  }
}
