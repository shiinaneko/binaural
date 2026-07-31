/**
 * 波レイヤー（SPEC.md §3.3）。
 *
 * ブラウンノイズをローパスに通し、カットオフと振幅を同じ変調源で連動させる。
 * 寄せて引くときに音が暗くなる（高域が引っ込む）ことで、単なる音量の上下ではなく
 * 「波」として聞こえる。
 *
 * 変調源は非整数比の 3 つの LFO の和にしている。仕様の初稿ではランダムウォークと
 * 書いていたが、25 分のセッション中に周期の反復が知覚されなければ十分で、
 * 非整数比の和なら追加のバッファもノードも要らずに同じ効果が得られる。
 * 3 波の合成周期は数時間規模になるため、セッション内で同じ波形は繰り返さない。
 */

import { wrapPhase } from '../phase';
import { createSineWave } from '../waveform';
import { LayerBase } from './base';
import { createNoiseBuffer } from './noise';

/** 非整数比の LFO 群（Hz と振幅）。振幅の合計は 1.0 */
const LFOS: Array<{ hz: number; amp: number }> = [
  { hz: 0.055, amp: 0.45 },
  { hz: 0.083, amp: 0.33 },
  { hz: 0.031, amp: 0.22 },
];

/** ローパスのカットオフ: 中心 ± 変調幅 → 300–1200 Hz */
const CUTOFF_CENTER_HZ = 750;
const CUTOFF_SWING_HZ = 450;
/** 振幅: 中心 ± 変調幅 → 0.27–0.97 */
const AMP_CENTER = 0.62;
const AMP_SWING = 0.35;
/**
 * ソースの RMS=1.0 に対する内部トリム。ローパスと振幅変調で下がるぶんを戻す。
 * level=1 での出力 RMS が LAYER_REFERENCE_DB と一致するようオフライン実測で校正した値
 * （最初に置いた 3.4 ではピークが 1.0 を超えていた）。
 */
const INTERNAL_TRIM = 1.54;

export class OceanLayer extends LayerBase {
  private readonly source: AudioBufferSourceNode;
  private readonly lfos: OscillatorNode[] = [];
  private readonly nodes: AudioNode[] = [];
  private readonly alignSec: number;

  constructor(ctx: BaseAudioContext, seed: number, alignSec = 0) {
    super(ctx, 'ocean');
    this.alignSec = alignSec;

    this.source = ctx.createBufferSource();
    this.source.buffer = createNoiseBuffer(ctx, 'brown', seed);
    this.source.loop = true;

    const lowpass = ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = CUTOFF_CENTER_HZ;
    lowpass.Q.value = 0.9;

    const amp = ctx.createGain();
    amp.gain.value = AMP_CENTER;

    const trim = ctx.createGain();
    trim.gain.value = INTERNAL_TRIM;

    this.source.connect(lowpass).connect(amp).connect(trim).connect(this.output);
    this.nodes.push(lowpass, amp, trim);

    // 変調源: 3 つの LFO を 1 本にまとめ、カットオフと振幅の両方へ分配する
    const modSum = ctx.createGain();
    modSum.gain.value = 1;
    for (const { hz, amp: lfoAmp } of LFOS) {
      const osc = ctx.createOscillator();
      if (alignSec !== 0) {
        // 絶対時刻に対応する位相から始める（分割レンダリングの境界を一致させる）
        osc.setPeriodicWave(createSineWave(ctx, wrapPhase(2 * Math.PI * hz * alignSec)));
      } else {
        osc.type = 'sine';
      }
      osc.frequency.value = hz;
      const gain = ctx.createGain();
      gain.gain.value = lfoAmp;
      osc.connect(gain).connect(modSum);
      this.lfos.push(osc);
      this.nodes.push(gain);
    }

    const toCutoff = ctx.createGain();
    toCutoff.gain.value = CUTOFF_SWING_HZ;
    modSum.connect(toCutoff).connect(lowpass.frequency);

    const toAmp = ctx.createGain();
    toAmp.gain.value = AMP_SWING;
    modSum.connect(toAmp).connect(amp.gain);

    this.nodes.push(modSum, toCutoff, toAmp);
  }

  start(when: number): void {
    if (this.started) return;
    this.started = true;
    const duration = this.source.buffer?.duration ?? 10;
    const offset = ((this.alignSec % duration) + duration) % duration;
    this.source.start(when, offset);
    // LFO の位相は生成時に絶対時刻へ合わせてある（シードに依らず常に同じ波の出方）
    for (const osc of this.lfos) osc.start(when);
  }

  stop(when: number): void {
    if (!this.started || this.stopped) return;
    this.stopped = true;
    this.source.stop(when);
    for (const osc of this.lfos) osc.stop(when);
  }

  dispose(): void {
    this.disconnectAll([this.source, ...this.lfos, ...this.nodes, this.output]);
  }
}
