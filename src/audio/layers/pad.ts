/**
 * 温かいパッドレイヤー（SPEC.md §3.3）。
 *
 * ここが Phase 2 でいちばん神経を使うところ。パッドは音高を持つので、
 * 置き方を間違えると搬送波と干渉して「意図しないうなり」を作ってしまう。
 * それはバイノーラルビートの知覚を直接汚す。
 *
 * 対策:
 * - 波形は **三角波**。三角波は奇数倍音しか持たない（偶数倍音がほぼ無い）。
 * - 音高は搬送波 fc の 0.5 / 0.75 / 1.5 倍。それぞれの奇数倍音は
 *     0.5fc → 0.5, 1.5, 2.5, 3.5 …
 *     0.75fc → 0.75, 2.25, 3.75 …
 *     1.5fc → 1.5, 4.5 …
 *   となり、**どの倍音も 1.0fc に一致しない**。搬送波と数 Hz 以内で近接する成分が
 *   生まれないため、ゆっくりしたうなりが発生しない。
 * - さらにローパス 400–900 Hz を通すので、高次倍音はそもそも残らない。
 *
 * 声ごとの ±3 cent のデチューンは、パッド内部でのゆるい揺らぎ（コーラス）を作るためのもので、
 * 搬送波とは無関係。
 */

import { wrapPhase } from '../phase';
import { createSineWave, createTriangleWave } from '../waveform';
import { LayerBase } from './base';

/** 搬送波に対する音高比。三角波の倍音が 1.0fc に当たらない組み合わせ */
const VOICE_RATIOS = [0.5, 0.75, 1.5];
const VOICE_GAINS = [1.0, 0.55, 0.4];
/** 各声を ±このセント数でデチューンした 2 基で鳴らす */
const DETUNE_CENTS = 3;

const FILTER_CENTER_HZ = 650;
const FILTER_SWING_HZ = 250;
const FILTER_LFO_HZ = 0.05;

/** level=1 での出力 RMS が LAYER_REFERENCE_DB と一致するようオフライン実測で校正した値 */
const INTERNAL_TRIM = 0.99;
/** 搬送波が変わったときに音高が移る時間。書き出しの位相計算でも同じ値を使う。 */
export const PAD_GLIDE_SEC = 1.5;

interface Voice {
  osc: OscillatorNode;
  ratio: number;
  detuneCents: number;
}

export class PadLayer extends LayerBase {
  private readonly voices: Voice[] = [];
  private readonly lfo: OscillatorNode;
  private readonly nodes: AudioNode[] = [];
  private tonalCenterHz: number;

  /**
   * @param alignSec 分割レンダリング用。LFO 位相をこの絶対時刻に合わせる
   * @param tonalPhase alignSec における音高中心（ratio=1）の累積位相。各声は ratio 倍して使う
   */
  constructor(
    ctx: BaseAudioContext,
    seed: number,
    carrierHz = 240,
    alignSec = 0,
    tonalPhase = 0,
  ) {
    super(ctx, 'pad');
    this.tonalCenterHz = carrierHz;

    const lowpass = ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = FILTER_CENTER_HZ;
    lowpass.Q.value = 0.8;

    const trim = ctx.createGain();
    trim.gain.value = INTERNAL_TRIM;

    lowpass.connect(trim).connect(this.output);
    this.nodes.push(lowpass, trim);

    // 位相の初期値をずらして、立ち上がりが揃いすぎないようにする
    const phaseSpread = (seed % 1000) / 1000;

    VOICE_RATIOS.forEach((ratio, index) => {
      const voiceGain = ctx.createGain();
      voiceGain.gain.value = VOICE_GAINS[index]!;
      voiceGain.connect(lowpass);
      this.nodes.push(voiceGain);

      for (const sign of [-1, 1]) {
        const osc = ctx.createOscillator();
        const detuneCents = sign * DETUNE_CENTS * (1 + phaseSpread * 0.2);
        // 声ごとの累積位相 = 基準位相 × 音高比（デチューン込み）。
        // 位相 0 でも同じ生成波形を使う——チャンクごとに音色が変わらないようにするため。
        const voiceRatio = ratio * Math.pow(2, detuneCents / 1200);
        osc.setPeriodicWave(createTriangleWave(ctx, wrapPhase(tonalPhase * voiceRatio)));
        osc.frequency.value = this.tonalCenterHz * ratio;
        osc.detune.value = detuneCents;
        osc.connect(voiceGain);
        this.voices.push({ osc, ratio, detuneCents });
      }
    });

    // ローパスをごく遅く揺らす（0.05 Hz = 20 秒周期）
    this.lfo = ctx.createOscillator();
    if (alignSec !== 0) {
      this.lfo.setPeriodicWave(
        createSineWave(ctx, wrapPhase(2 * Math.PI * FILTER_LFO_HZ * alignSec)),
      );
    } else {
      this.lfo.type = 'sine';
    }
    this.lfo.frequency.value = FILTER_LFO_HZ;
    const toFilter = ctx.createGain();
    toFilter.gain.value = FILTER_SWING_HZ;
    this.lfo.connect(toFilter).connect(lowpass.frequency);
    this.nodes.push(toFilter);
  }

  start(when: number): void {
    if (this.started) return;
    this.started = true;
    for (const { osc } of this.voices) osc.start(when);
    this.lfo.start(when);
  }

  stop(when: number): void {
    if (!this.started || this.stopped) return;
    this.stopped = true;
    for (const { osc } of this.voices) osc.stop(when);
    this.lfo.stop(when);
  }

  /** セグメントの搬送波に音高を追随させる。音程変化として知覚されるのでゆっくり移らせる。 */
  setTonalCenterHz(carrierHz: number, when = this.ctx.currentTime): void {
    if (carrierHz === this.tonalCenterHz) return;
    this.tonalCenterHz = carrierHz;
    const now = Math.max(when, this.ctx.currentTime);
    for (const { osc, ratio } of this.voices) {
      const param = osc.frequency;
      if (typeof param.cancelAndHoldAtTime === 'function') {
        param.cancelAndHoldAtTime(now);
      } else {
        param.cancelScheduledValues(now);
        param.setValueAtTime(param.value, now);
      }
      param.linearRampToValueAtTime(carrierHz * ratio, now + PAD_GLIDE_SEC);
    }
  }

  /** 現在の音高構成（検証・表示用） */
  get voiceFrequencies(): number[] {
    return this.voices.map(({ ratio, detuneCents }) => {
      return this.tonalCenterHz * ratio * Math.pow(2, detuneCents / 1200);
    });
  }

  dispose(): void {
    this.disconnectAll([...this.voices.map((v) => v.osc), this.lfo, ...this.nodes, this.output]);
  }
}
