/**
 * 搬送波コア（SPEC.md §3.1 / §3.2）。
 *
 *   left  = sin(2π (fc − Δf/2) t)
 *   right = sin(2π (fc + Δf/2) t)
 *
 * 重要な制約:
 * - このクラスの output より下流で、左右チャンネルを混ぜる処理を通してはならない
 *   （リバーブ、モノダウンミックス、ステレオ加工は位相差を壊す）。
 * - 周波数・ゲインの変更は必ず AudioParam のランプで行う。ノードの生成破棄で
 *   表現するとクリックが出る。
 *
 * モードによる左右のルーティングはゲインだけで切り替える（配線は固定）。
 * 再配線を避けることで、モード変更時のクリックを構造的に防いでいる。
 */

import { beatHzAt, curveDurationSec } from './BeatCurve';
import { applyBreakpoints, type Breakpoint } from './breakpoints';
import {
  buildSegmentBreakpoints,
  spreadForMode,
  type CarrierBreakpoints,
} from './carrierSchedule';
import { carrierGain } from './loudness';
import type { BeatConfig, BeatCurve, BeatMode } from './types';
import { createGateWave, createSineWave } from './waveform';

/** 各モードのルーティング係数。direct = 同じ側へ、cross = 反対側へ送る量。 */
interface Routing {
  directL: number;
  directR: number;
  crossLR: number;
  crossRL: number;
  /** 搬送波を fc ∓ Δf/2 に開く度合い。0 なら両方 fc（アイソクロニック用） */
  spread: number;
  /** モード既定の AM 深度（config.amDepth を使わないモードでは 0） */
  usesAm: boolean;
}

function routingFor(mode: BeatMode): Routing {
  const spread = spreadForMode(mode);
  switch (mode) {
    case 'binaural':
      // 左右完全独立。これだけが真のバイノーラルビート
      return { directL: 1, directR: 1, crossLR: 0, crossRL: 0, spread, usesAm: false };
    case 'hybrid':
      // バイノーラル + 浅い AM（Δf が高く知覚が弱いときの補助）
      return { directL: 1, directR: 1, crossLR: 0, crossRL: 0, spread, usesAm: true };
    case 'monaural':
      // 2 つの搬送波を同一チャンネルに加算 → 物理的なうなり。スピーカーで機能する
      return { directL: 0.5, directR: 0.5, crossLR: 0.5, crossRL: 0.5, spread, usesAm: false };
    case 'isochronic':
      // 単一搬送波（fc）を Δf でゲーティング。右オシレータは使わない
      return { directL: 1, directR: 0, crossLR: 1, crossRL: 0, spread, usesAm: true };
  }
}

const GLIDE_SEC = 0.12;

/** 分割レンダリングで境界の位相を繋ぐための初期位相（ラジアン） */
export interface InitialPhase {
  left: number;
  right: number;
  am: number;
}

export interface BinauralPairOptions {
  /**
   * 各オシレータの初期位相。分割オフラインレンダリングのときだけ渡す。
   * 省略時は 0（= 組み込み sine と同一）。
   */
  initialPhase?: InitialPhase;
}

export class BinauralPair {
  /** 下流へ繋ぐ出力。ステレオ 2ch。エフェクトを挿入してはならない。 */
  readonly output: GainNode;

  private readonly ctx: BaseAudioContext;
  private readonly oscL: OscillatorNode;
  private readonly oscR: OscillatorNode;
  private readonly dirL: GainNode;
  private readonly dirR: GainNode;
  private readonly crossLR: GainNode;
  private readonly crossRL: GainNode;
  private readonly merger: ChannelMergerNode;
  private readonly amGain: GainNode;
  private readonly amOsc: OscillatorNode;
  private readonly amDepthGain: GainNode;

  private config: BeatConfig;
  private started = false;
  private stopped = false;
  private lastBeatHz: number;
  /** 最後にスケジュールした搬送波周波数。将来時刻の状態を追跡するため config とは別に持つ。 */
  private scheduledCarrierHz: number;

  constructor(ctx: BaseAudioContext, config: BeatConfig, opts: BinauralPairOptions = {}) {
    this.ctx = ctx;
    this.config = config;
    this.scheduledCarrierHz = config.carrierHz;
    this.lastBeatHz = config.curve.points[0]?.hz ?? 10;

    const routing = routingFor(config.mode);
    const spreadHalf = (routing.spread * this.lastBeatHz) / 2;
    const phase = opts.initialPhase;

    this.oscL = ctx.createOscillator();
    this.oscR = ctx.createOscillator();
    // 位相指定が無ければ組み込み sine（PeriodicWave の φ=0 と完全一致するが、
    // テーブル補間を挟まない組み込みのほうが素直）
    if (phase) {
      this.oscL.setPeriodicWave(createSineWave(ctx, phase.left));
      this.oscR.setPeriodicWave(createSineWave(ctx, phase.right));
    } else {
      this.oscL.type = 'sine';
      this.oscR.type = 'sine';
    }
    this.oscL.frequency.value = config.carrierHz - spreadHalf;
    this.oscR.frequency.value = config.carrierHz + spreadHalf;

    const g = carrierGain(config.gainDb, config.carrierHz);
    this.dirL = ctx.createGain();
    this.dirR = ctx.createGain();
    this.crossLR = ctx.createGain();
    this.crossRL = ctx.createGain();
    this.dirL.gain.value = routing.directL * g;
    this.dirR.gain.value = routing.directR * g;
    this.crossLR.gain.value = routing.crossLR * g;
    this.crossRL.gain.value = routing.crossRL * g;

    this.merger = ctx.createChannelMerger(2);
    this.oscL.connect(this.dirL).connect(this.merger, 0, 0);
    this.oscR.connect(this.dirR).connect(this.merger, 0, 1);
    this.oscL.connect(this.crossLR).connect(this.merger, 0, 1);
    this.oscR.connect(this.crossRL).connect(this.merger, 0, 0);

    // AM 段。左右に同一のゲインが掛かるため位相関係は保たれる。
    const depth = routing.usesAm ? config.amDepth : 0;
    this.amGain = ctx.createGain();
    this.amGain.gain.value = 1 - depth / 2;

    this.amOsc = ctx.createOscillator();
    this.amOsc.setPeriodicWave(createGateWave(ctx, phase?.am ?? 0));
    this.amOsc.frequency.value = Math.max(this.lastBeatHz, 0.01);

    this.amDepthGain = ctx.createGain();
    this.amDepthGain.gain.value = depth / 2;
    this.amOsc.connect(this.amDepthGain).connect(this.amGain.gain);

    this.output = ctx.createGain();
    this.output.gain.value = 1;
    this.merger.connect(this.amGain).connect(this.output);
  }

  get mode(): BeatMode {
    return this.config.mode;
  }

  get carrierHz(): number {
    return this.config.carrierHz;
  }

  /** 直近にスケジュールした Δf（表示用） */
  get beatHz(): number {
    return this.lastBeatHz;
  }

  start(when: number): void {
    if (this.started) return;
    this.started = true;
    this.oscL.start(when);
    this.oscR.start(when);
    this.amOsc.start(when);
  }

  /** 停止後は再利用できない。新しいセッションでは作り直す。 */
  stop(when: number): void {
    if (!this.started || this.stopped) return;
    this.stopped = true;
    this.oscL.stop(when);
    this.oscR.stop(when);
    this.amOsc.stop(when);
  }

  /**
   * カーブを startTime 起点で一括スケジュールする。
   *
   * 時間グリッドは toRampSteps で決め、値は beatHzAt から取る
   * （smooth 補間は微小な linearRamp の連鎖で S 字を近似する）。
   *
   * セグメントをまたいで搬送波を変える場合は carrierHz を渡す。音程変化として
   * 知覚されるため carrierGlideSec でゆっくり移らせ、等ラウドネス補正も同じ時間で追随させる。
   */
  scheduleCurve(
    startTime: number,
    curve: BeatCurve,
    opts: { carrierHz?: number; carrierGlideSec?: number } = {},
  ): void {
    const prevFc = this.scheduledCarrierHz;
    const targetFc = opts.carrierHz ?? prevFc;
    const glideSec = targetFc === prevFc ? 0 : Math.max(opts.carrierGlideSec ?? 0, 0);

    // ブレークポイントの生成は純関数に委譲する。
    // 分割レンダリングの位相計算がまったく同じ関数を通るため、両者が食い違わない。
    const breakpoints = buildSegmentBreakpoints({
      curve,
      fromCarrierHz: prevFc,
      toCarrierHz: targetFc,
      carrierGlideSec: glideSec,
      spread: routingFor(this.config.mode).spread,
    });

    applyBreakpoints(this.oscL.frequency, breakpoints.left, startTime);
    applyBreakpoints(this.oscR.frequency, breakpoints.right, startTime);
    applyBreakpoints(this.amOsc.frequency, breakpoints.am, startTime);

    if (targetFc !== prevFc) {
      const routing = routingFor(this.config.mode);
      const fromGain = carrierGain(this.config.gainDb, prevFc);
      const toGain = carrierGain(this.config.gainDb, targetFc);
      const gainTargets: Array<[AudioParam, number]> = [
        [this.dirL.gain, routing.directL],
        [this.dirR.gain, routing.directR],
        [this.crossLR.gain, routing.crossLR],
        [this.crossRL.gain, routing.crossRL],
      ];
      for (const [param, k] of gainTargets) {
        param.cancelScheduledValues(startTime);
        param.setValueAtTime(k * fromGain, startTime);
        if (glideSec > 0) {
          param.linearRampToValueAtTime(k * toGain, startTime + glideSec);
        } else {
          param.setValueAtTime(k * toGain, startTime);
        }
      }
      this.scheduledCarrierHz = targetFc;
      this.config = { ...this.config, carrierHz: targetFc };
    }

    this.lastBeatHz = beatHzAt(curve, curveDurationSec(curve));
  }

  /**
   * 分割レンダリング用: 絶対時間で組み立て済みのブレークポイントを直接流し込む。
   *
   * scheduleCurve が「セグメント単位で組み立てて適用する」のに対し、
   * こちらは「タイムライン全体から切り出した窓」を適用する。
   * どちらも同じ buildSegmentBreakpoints の出力を通るので結果は一致する。
   */
  applyCarrierBreakpoints(points: CarrierBreakpoints, offsetSec: number): void {
    applyBreakpoints(this.oscL.frequency, points.left, offsetSec);
    applyBreakpoints(this.oscR.frequency, points.right, offsetSec);
    applyBreakpoints(this.amOsc.frequency, points.am, offsetSec);
    const last = points.right[points.right.length - 1];
    const lastLeft = points.left[points.left.length - 1];
    if (last && lastLeft) {
      this.lastBeatHz = last.value - lastLeft.value;
      this.scheduledCarrierHz = (last.value + lastLeft.value) / 2;
    }
  }

  /** 分割レンダリング用: 等ラウドネス補正込みの搬送波ゲインを直接流し込む */
  applyGainBreakpoints(points: Breakpoint[], offsetSec: number): void {
    const routing = routingFor(this.config.mode);
    const scaled = (k: number): Breakpoint[] => points.map((p) => ({ t: p.t, value: p.value * k }));
    applyBreakpoints(this.dirL.gain, scaled(routing.directL), offsetSec);
    applyBreakpoints(this.dirR.gain, scaled(routing.directR), offsetSec);
    applyBreakpoints(this.crossLR.gain, scaled(routing.crossLR), offsetSec);
    applyBreakpoints(this.crossRL.gain, scaled(routing.crossRL), offsetSec);
  }

  /** Studio でのライブ編集用。現在値から短くグライドして目標へ移る（クリックなし）。 */
  setBeatHz(hz: number, when = this.ctx.currentTime): void {
    const spread = routingFor(this.config.mode).spread;
    const fc = this.config.carrierHz;
    this.glide(this.oscL.frequency, fc - (spread * hz) / 2, when);
    this.glide(this.oscR.frequency, fc + (spread * hz) / 2, when);
    this.glide(this.amOsc.frequency, Math.max(hz, 0.01), when);
    this.lastBeatHz = hz;
  }

  setCarrierHz(hz: number, when = this.ctx.currentTime): void {
    this.config = { ...this.config, carrierHz: hz };
    this.scheduledCarrierHz = hz;
    this.setBeatHz(this.lastBeatHz, when);
    this.applyRouting(when);
  }

  setGainDb(db: number, when = this.ctx.currentTime): void {
    this.config = { ...this.config, gainDb: db };
    this.applyRouting(when);
  }

  setAmDepth(depth: number, when = this.ctx.currentTime): void {
    this.config = { ...this.config, amDepth: depth };
    const d = routingFor(this.config.mode).usesAm ? depth : 0;
    this.glide(this.amGain.gain, 1 - d / 2, when);
    this.glide(this.amDepthGain.gain, d / 2, when);
  }

  setMode(mode: BeatMode, when = this.ctx.currentTime): void {
    this.config = { ...this.config, mode };
    this.applyRouting(when);
    this.setAmDepth(this.config.amDepth, when);
    this.setBeatHz(this.lastBeatHz, when);
  }

  private applyRouting(when: number): void {
    const routing = routingFor(this.config.mode);
    const g = carrierGain(this.config.gainDb, this.config.carrierHz);
    this.glide(this.dirL.gain, routing.directL * g, when);
    this.glide(this.dirR.gain, routing.directR * g, when);
    this.glide(this.crossLR.gain, routing.crossLR * g, when);
    this.glide(this.crossRL.gain, routing.crossRL * g, when);
  }

  private glide(param: AudioParam, target: number, when: number): void {
    const now = Math.max(when, this.ctx.currentTime);
    // cancelAndHoldAtTime があれば進行中のランプを現在値で止めてから繋ぐ
    if (typeof param.cancelAndHoldAtTime === 'function') {
      param.cancelAndHoldAtTime(now);
    } else {
      param.cancelScheduledValues(now);
      param.setValueAtTime(param.value, now);
    }
    param.linearRampToValueAtTime(target, now + GLIDE_SEC);
  }

  dispose(): void {
    for (const node of [
      this.output,
      this.amGain,
      this.amDepthGain,
      this.merger,
      this.dirL,
      this.dirR,
      this.crossLR,
      this.crossRL,
      this.oscL,
      this.oscR,
      this.amOsc,
    ]) {
      try {
        node.disconnect();
      } catch {
        // すでに切断済み
      }
    }
  }
}
