/**
 * オーディオグラフの組み立てとマスター段（SPEC.md §3.5）。
 *
 *   搬送波バス ─────────────────────────────┐（エフェクトなし）
 *                                            ├→ セッションフェード → 音量 → リミッタ → out
 *   環境音バス → HP20 → 環境音リミッタ ──────┘                ↑
 *                                              チャイム ───────┘（フェードの影響を受けない）
 *
 * BaseAudioContext を受け取る設計にしているため、リアルタイム再生と
 * OfflineAudioContext での WAV 書き出しがまったく同じコードを通る（SPEC.md §9）。
 */

import { BinauralPair, type BinauralPairOptions } from './BinauralPair';
import { scheduleChime, type ChimeOptions } from './chime';
import { applyBreakpoints, type Breakpoint } from './breakpoints';
import { createAmbienceLayer, type AmbienceLayer, type CreateLayerOptions } from './layers';
import { dbToGain } from './loudness';
import { seedFromString } from './prng';
import { createImpulseResponse } from './reverb';
import type { AmbienceId, AmbienceMix, BeatConfig } from './types';

const VOLUME_RAMP_SEC = 0.08;
/** 音量 0–1 をこのレンジの dB に写す。1.0 で 0 dB（ブーストはしない） */
const VOLUME_RANGE_DB = 45;

export function volumeToGain(volume: number): number {
  if (volume <= 0) return 0;
  const v = Math.min(volume, 1);
  return dbToGain(-VOLUME_RANGE_DB * (1 - v));
}

/**
 * 保護用ソフトクリッパーの伝達曲線。
 *
 * DynamicsCompressor は使わない: Chrome の実装は圧縮していないときでも内部メイクアップゲイン
 * （実測で約 +2 dB）を常に掛けるため、せっかく等ラウドネスで揃えたレベル設計が崩れる。
 * WaveShaper なら閾値以下は完全に線形（透明）で、左右に同一の写像が掛かるため位相も保たれる。
 *
 *   |x| ≤ t          → y = x                                   （そのまま通す）
 *   |x| > t          → y = t + (1−t)·tanh((|x|−t)/(1−t))        （滑らかに飽和）
 *
 * t の点で微分係数が 1 で連続するので、折れ点による歪みが出ない。
 */
export function createSoftClipCurve(thresholdDb = -6, samples = 4096): Float32Array<ArrayBuffer> {
  const t = dbToGain(thresholdDb);
  const curve = new Float32Array(new ArrayBuffer(samples * 4));
  for (let i = 0; i < samples; i++) {
    const x = (i / (samples - 1)) * 2 - 1;
    const a = Math.abs(x);
    const y = a <= t ? a : t + (1 - t) * Math.tanh((a - t) / (1 - t));
    curve[i] = Math.sign(x) * y;
  }
  return curve;
}

export interface AudioEngineOptions {
  /** 初期音量 0–1 */
  volume?: number;
  /**
   * 出力先。省略時は ctx.destination。
   *
   * リアルタイム再生では MediaStreamAudioDestinationNode を渡して `<audio>` 要素へ流す
   * （Android でバックグラウンド再生を維持するため。SPEC.md §6）。
   * この経路が位相を壊さないことは実測で確認済み（分離 91 dB 以上）。
   * 書き出し（OfflineAudioContext）では常に ctx.destination を使う。
   */
  sink?: AudioNode;
}

export class AudioEngine {
  readonly ctx: BaseAudioContext;

  /** 搬送波の入口。ここから下流に位相を壊す処理を入れてはならない。 */
  readonly carrierBus: GainNode;
  /** 環境音の入口。リバーブ・コンプはこちら側にのみ挿入する。 */
  readonly ambienceBus: GainNode;
  /** セッションのフェードイン/アウト専用 */
  readonly sessionFade: GainNode;
  /** ユーザー音量 */
  readonly volumeNode: GainNode;
  /** 保護用ソフトクリッパー。閾値以下は透明で、通常は何もしない。 */
  readonly limiter: WaveShaperNode;

  private readonly ambienceHp: BiquadFilterNode;
  private readonly chimeBus: GainNode;
  /** 環境音の素のまま（ドライ）の経路 */
  private readonly dryGain: GainNode;
  /** 畳み込みを通した（ウェット）経路。搬送波は絶対にここを通さない。 */
  private readonly convolver: ConvolverNode;
  private readonly wetGain: GainNode;

  private pair: BinauralPair | null = null;
  private readonly layers = new Map<AmbienceId, AmbienceLayer>();
  private layersStartedAt: number | null = null;
  private currentVolume: number;
  /** 最後に予約したセッションフェードの目標値（将来時刻の状態を追跡する） */
  private scheduledFade = 0;
  /** パッドなど音高を持つレイヤーが参照する搬送波 */
  private tonalCenterHz = 240;

  constructor(ctx: BaseAudioContext, opts: AudioEngineOptions = {}) {
    this.ctx = ctx;
    this.currentVolume = opts.volume ?? 0.6;

    this.limiter = ctx.createWaveShaper();
    this.limiter.curve = createSoftClipCurve(-6);
    this.limiter.oversample = '4x';
    this.limiter.connect(opts.sink ?? ctx.destination);

    this.volumeNode = ctx.createGain();
    this.volumeNode.gain.value = volumeToGain(this.currentVolume);
    this.volumeNode.connect(this.limiter);

    this.sessionFade = ctx.createGain();
    this.sessionFade.gain.value = 0;
    this.sessionFade.connect(this.volumeNode);

    this.carrierBus = ctx.createGain();
    this.carrierBus.gain.value = 1;
    this.carrierBus.connect(this.sessionFade);

    this.ambienceBus = ctx.createGain();
    this.ambienceBus.gain.value = 1;

    this.ambienceHp = ctx.createBiquadFilter();
    this.ambienceHp.type = 'highpass';
    this.ambienceHp.frequency.value = 20;
    this.ambienceHp.Q.value = 0.7;

    // 環境音側には動的処理を入れない。各レイヤーは基準レベルで正規化済みで、
    // ここにコンプを挿すと（メイクアップゲインとポンピングで）レベル設計が崩れる。
    this.ambienceBus.connect(this.ambienceHp);

    // リバーブは環境音バスにのみ挿入する（畳み込みは左右の位相関係を壊すため、
    // 搬送波バスには絶対に通さない）。IR は実行時生成でファイルを持たない。
    this.dryGain = ctx.createGain();
    this.dryGain.gain.value = 1;
    this.ambienceHp.connect(this.dryGain).connect(this.sessionFade);

    this.convolver = ctx.createConvolver();
    this.convolver.normalize = false; // IR 側で sum(h²)=1 に正規化済み
    this.convolver.buffer = createImpulseResponse(ctx, { decaySec: 2.6, dampingHz: 8000 });
    this.wetGain = ctx.createGain();
    this.wetGain.gain.value = 0;
    this.ambienceHp.connect(this.convolver).connect(this.wetGain).connect(this.sessionFade);

    // チャイムはセッションフェードを迂回する（終了フェード中でも鳴る必要がある）
    this.chimeBus = ctx.createGain();
    this.chimeBus.gain.value = 1;
    this.chimeBus.connect(this.volumeNode);
  }

  // -------------------------------------------------------------------------
  // 搬送波
  // -------------------------------------------------------------------------

  /** 既存のペアを破棄して作り直す。start() は呼び出し側で行う。 */
  createPair(
    config: BeatConfig,
    stopAt = this.ctx.currentTime,
    opts: BinauralPairOptions = {},
  ): BinauralPair {
    if (this.pair) {
      this.pair.stop(stopAt);
      this.pair.dispose();
    }
    const pair = new BinauralPair(this.ctx, config, opts);
    pair.output.connect(this.carrierBus);
    this.pair = pair;
    return pair;
  }

  get currentPair(): BinauralPair | null {
    return this.pair;
  }

  // -------------------------------------------------------------------------
  // 環境音
  // -------------------------------------------------------------------------

  /** レイヤーを（必要なら生成して）返す。未実装の ID は null。 */
  ensureLayer(id: AmbienceId, seed: number): AmbienceLayer | null {
    if (id === 'none') return null;
    const existing = this.layers.get(id);
    if (existing) return existing;

    const layer = createAmbienceLayer(this.ctx, id, (seed + seedFromString(id)) >>> 0, {
      carrierHz: this.tonalCenterHz,
    });
    if (!layer) return null;
    layer.output.connect(this.ambienceBus);
    layer.setLevel(0, this.ctx.currentTime);
    if (this.layersStartedAt !== null) {
      layer.start(Math.max(this.layersStartedAt, this.ctx.currentTime));
    }
    this.layers.set(id, layer);
    return layer;
  }

  /**
   * ミックスを適用する。mix に含まれないレイヤーは 0 に落とす（音を止めずに退場させる）。
   * @param rampSec 0 なら setLevel の既定ランプ、>0 なら startTime→startTime+rampSec でランプ
   */
  applyAmbienceMix(mix: AmbienceMix, startTime = this.ctx.currentTime, rampSec = 0): void {
    for (const id of Object.keys(mix.layers) as AmbienceId[]) {
      this.ensureLayer(id, mix.seed);
    }

    for (const [id, layer] of this.layers) {
      const level = mix.layers[id] ?? 0;
      if (rampSec > 0 && layer.rampLevel) {
        layer.rampLevel(level, startTime, startTime + rampSec);
      } else {
        layer.setLevel(level, startTime);
      }
    }

    this.setReverbMix(mix.reverb, startTime, rampSec);
  }

  /**
   * 分割レンダリング用: 生成オプションを明示してレイヤーを作る。
   * ensureLayer と違い、シードは呼び出し側（タイムラインプラン）が決めたものをそのまま使う。
   */
  createAlignedLayer(
    id: AmbienceId,
    seed: number,
    opts: CreateLayerOptions,
  ): AmbienceLayer | null {
    const existing = this.layers.get(id);
    if (existing) return existing;
    const layer = createAmbienceLayer(this.ctx, id, seed, opts);
    if (!layer) return null;
    layer.output.connect(this.ambienceBus);
    this.layers.set(id, layer);
    return layer;
  }

  /** 分割レンダリング用: リバーブ送りをブレークポイントで直接与える */
  applyReverbBreakpoints(points: Breakpoint[], offsetSec: number): void {
    const clamp = (v: number) => Math.min(Math.max(v, 0), 1);
    applyBreakpoints(
      this.dryGain.gain,
      points.map((p) => ({ t: p.t, value: 1 - 0.25 * clamp(p.value) })),
      offsetSec,
    );
    applyBreakpoints(
      this.wetGain.gain,
      points.map((p) => ({ t: p.t, value: 0.55 * clamp(p.value) })),
      offsetSec,
    );
  }

  /** 分割レンダリング用: セッションフェードをブレークポイントで直接与える */
  applyFadeBreakpoints(points: Breakpoint[], offsetSec: number): void {
    applyBreakpoints(this.sessionFade.gain, points, offsetSec);
    const last = points[points.length - 1];
    if (last) this.scheduledFade = last.value;
  }

  /**
   * リバーブ送り量。ドライは残したままウェットを足す（雰囲気を「加える」感覚に合わせる）。
   * IR は sum(h²)=1 に正規化してあるので、wet=1 でドライと同程度のエネルギーになる。
   * そのままでは多すぎるので 0.55 を上限とし、ドライを少し下げて総量を整える。
   */
  setReverbMix(amount: number, startTime = this.ctx.currentTime, rampSec = 0): void {
    const r = Math.min(Math.max(amount, 0), 1);
    const rampTo = (param: AudioParam, target: number) => {
      const at = Math.max(startTime, this.ctx.currentTime);
      if (typeof param.cancelAndHoldAtTime === 'function') {
        param.cancelAndHoldAtTime(at);
      } else {
        param.cancelScheduledValues(at);
        param.setValueAtTime(param.value, at);
      }
      param.linearRampToValueAtTime(target, at + Math.max(rampSec, 0.05));
    };
    rampTo(this.dryGain.gain, 1 - 0.25 * r);
    rampTo(this.wetGain.gain, 0.55 * r);
  }

  /**
   * 音高を持つレイヤー（パッド）に、そのセグメントの搬送波を伝える。
   * 搬送波と協和しない音高になると意図しないうなりが生まれるため、
   * セグメントごとに必ず更新する。
   */
  setTonalCenter(carrierHz: number, when = this.ctx.currentTime): void {
    this.tonalCenterHz = carrierHz;
    for (const layer of this.layers.values()) {
      layer.setTonalCenterHz?.(carrierHz, when);
    }
  }

  /**
   * 粒を持つレイヤー（雨など）の先読みスケジューリング。
   * リアルタイムでは tick から 0.6 秒先まで、書き出しでは全長を一度に呼ぶ。
   */
  pumpLayers(untilTime: number): void {
    for (const layer of this.layers.values()) {
      layer.pump?.(untilTime);
    }
  }

  /** 全レイヤーの再生を開始する（以後生成されたレイヤーも自動で追随する） */
  startLayers(when: number): void {
    this.layersStartedAt = when;
    for (const layer of this.layers.values()) layer.start(when);
  }

  // -------------------------------------------------------------------------
  // マスター段
  // -------------------------------------------------------------------------

  /**
   * セッションのフェードを「未来の時刻」に対して予約する。終端を確定させたいので linearRamp を使う。
   *
   * 起点には param.value（=スケジュール時点の現在値）ではなく scheduledFade を使う。
   * 25 分先のフェードアウトを開始時に予約するため、現在値を起点にすると
   * まったく別の値から始まってしまう。
   * 前提: 呼び出しは startTime について単調増加であること。
   */
  fadeSession(target: number, startTime: number, durationSec: number): void {
    const param = this.sessionFade.gain;
    param.setValueAtTime(this.scheduledFade, startTime);
    if (durationSec <= 0) {
      param.setValueAtTime(target, startTime);
    } else {
      param.linearRampToValueAtTime(target, startTime + durationSec);
    }
    this.scheduledFade = target;
  }

  /**
   * 「今から」フェードアウトする（ユーザー操作による終了）。
   * 予約済みの以降の自動化を捨て、実際の現在値から繋ぐ。
   */
  fadeOutNow(durationSec: number): void {
    const param = this.sessionFade.gain;
    const now = this.ctx.currentTime;
    if (typeof param.cancelAndHoldAtTime === 'function') {
      param.cancelAndHoldAtTime(now);
    } else {
      param.cancelScheduledValues(now);
      param.setValueAtTime(param.value, now);
    }
    param.linearRampToValueAtTime(0, now + Math.max(durationSec, 0.02));
    this.scheduledFade = 0;
  }

  setVolume(volume: number, when = this.ctx.currentTime): void {
    this.currentVolume = Math.min(Math.max(volume, 0), 1);
    const param = this.volumeNode.gain;
    const now = Math.max(when, this.ctx.currentTime);
    if (typeof param.cancelAndHoldAtTime === 'function') {
      param.cancelAndHoldAtTime(now);
    } else {
      param.cancelScheduledValues(now);
      param.setValueAtTime(param.value, now);
    }
    param.linearRampToValueAtTime(volumeToGain(this.currentVolume), now + VOLUME_RAMP_SEC);
  }

  get volume(): number {
    return this.currentVolume;
  }

  chime(when: number, opts?: ChimeOptions): void {
    scheduleChime(this.ctx, this.chimeBus, when, opts);
  }

  // -------------------------------------------------------------------------

  stopAll(when: number): void {
    this.pair?.stop(when);
    for (const layer of this.layers.values()) layer.stop(when);
  }

  dispose(): void {
    this.pair?.dispose();
    this.pair = null;
    for (const layer of this.layers.values()) layer.dispose();
    this.layers.clear();
    this.layersStartedAt = null;
    for (const node of [
      this.carrierBus,
      this.ambienceBus,
      this.ambienceHp,
      this.dryGain,
      this.convolver,
      this.wetGain,
      this.chimeBus,
      this.sessionFade,
      this.volumeNode,
      this.limiter,
    ]) {
      try {
        node.disconnect();
      } catch {
        // すでに切断済み
      }
    }
  }
}
