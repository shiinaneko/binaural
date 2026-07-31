/**
 * ドメイン型定義。SPEC.md §8 に準拠。
 * このファイルと src/audio/ 以下は React に依存しない純 TS とし、
 * リアルタイム再生・OfflineAudioContext での書き出し・単体テストの三方から使う。
 */

export type BeatMode = 'binaural' | 'monaural' | 'isochronic' | 'hybrid';

export type Band = 'delta' | 'theta' | 'alpha' | 'smr' | 'beta' | 'gamma';

/** 帯域の定義（SPEC.md §3.1 の表） */
export interface BandSpec {
  id: Band;
  label: string;
  minHz: number;
  maxHz: number;
  defaultBeatHz: number;
  defaultCarrierHz: number;
  /** この帯域で純バイノーラルの知覚が弱く、AM 併用を推奨するか */
  preferAm: boolean;
  note: string;
}

export interface BeatCurvePoint {
  /** セグメント開始からの秒数 */
  t: number;
  /** ビート周波数 Δf */
  hz: number;
}

export interface BeatCurve {
  /** t 昇順、先頭は t=0 */
  points: BeatCurvePoint[];
  interpolation: 'linear' | 'smooth';
}

export interface BeatConfig {
  mode: BeatMode;
  /** 搬送波中心周波数 fc */
  carrierHz: number;
  /** AM 深度 0–1（isochronic / hybrid のみ有効） */
  amDepth: number;
  curve: BeatCurve;
  /** 等ラウドネス補正前の相対レベル（dBFS、既定 −30） */
  gainDb: number;
}

export type AmbienceId =
  | 'none'
  | 'brown'
  | 'pink'
  | 'rain'
  | 'ocean'
  | 'forest'
  | 'fire'
  | 'pad'
  | 'bowl'
  | 'drone'
  | 'air';

export interface AmbienceMix {
  /** レイヤー ID → 0–1 のレベル */
  layers: Partial<Record<AmbienceId, number>>;
  /** 環境音バスのリバーブ送り量 0–1 */
  reverb: number;
  /** ノイズ・粒生成を再現可能にするシード */
  seed: number;
}

export type SegmentKind = 'focus' | 'shortBreak' | 'longBreak';

export interface Segment {
  kind: SegmentKind;
  durationSec: number;
  beat: BeatConfig;
  ambience: AmbienceMix;
  fadeInSec: number;
  fadeOutSec: number;
  chimeAtEnd: boolean;
}

export interface SessionPreset {
  id: string;
  name: string;
  category: 'focus' | 'meditate' | 'custom';
  description: string;
  /** UI の配色キー */
  colorway: string;
  segments: Segment[];
  /** 集中/小休憩の繰り返し数（未指定なら segments をそのまま 1 周） */
  cycles?: number;
  createdAt: string;
  updatedAt: string;
  builtIn: boolean;
  schemaVersion: 1;
}

export interface SessionLogEntry {
  presetId: string;
  startedAt: string;
  plannedSec: number;
  completedSec: number;
  completed: boolean;
}

// ---------------------------------------------------------------------------
// 制約値（SPEC.md §3.1 / §4.2）
// ---------------------------------------------------------------------------

export const CARRIER_MIN_HZ = 80;
export const CARRIER_MAX_HZ = 600;
export const BEAT_MIN_HZ = 0.5;
export const BEAT_MAX_HZ = 45;

/** fc − Δf/2 がこれを下回る組み合わせは禁止（再生系の低域限界） */
export const SIDE_MIN_HZ = 40;

/** Δf の変化速度上限（Hz/分）。急激な変化は不快なため */
export const MAX_RATE_HZ_PER_MIN = {
  focus: 2.0,
  meditate: 0.5,
} as const;

export const DEFAULT_FADE_IN_SEC = 6;
export const DEFAULT_FADE_OUT_SEC = 8;
/** セグメント境界のクロスフェード長（音を止めずに繋ぐ） */
export const SEGMENT_CROSSFADE_SEC = 20;

/** 搬送波の既定レベル（dBFS、等ラウドネス補正前） */
export const DEFAULT_CARRIER_GAIN_DB = -30;
