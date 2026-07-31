import type { AmbienceId } from '../types';

/**
 * 環境音レイヤーの共通インターフェース。
 * 全レイヤーは合成のみで作られ、音源ファイルを持たない（SPEC.md §3.3）。
 */
export interface AmbienceLayer {
  readonly id: AmbienceId;
  /** レベル制御を兼ねる出力。書き出し経路ではここに直接ブレークポイントを流す。 */
  readonly output: GainNode;
  start(when: number): void;
  stop(when: number): void;
  /** 0–1 のミキサー値。0 で完全な無音になること。 */
  setLevel(level: number, when?: number): void;
  /** ミキサー値 → 出力ゲイン。ブレークポイントを直接流し込む書き出し経路で使う。 */
  gainForLevel(level: number): number;
  /** クロスフェードのように開始・終了時刻を厳密に指定したい場合に使う（任意実装） */
  rampLevel?(level: number, startTime: number, endTime: number): void;
  /**
   * 粒（雨・焚き火）を持つレイヤーの先読みスケジューリング。
   * リアルタイムでは tick から 0.5 秒先まで、書き出しでは全長を一度に呼ぶ。
   */
  pump?(untilTime: number): void;
  /**
   * 音高を持つレイヤー（パッド・ボウル）に、そのセグメントの搬送波を伝える。
   * 搬送波と協和しない音高になると、意図しないうなりが生まれてしまう。
   */
  setTonalCenterHz?(carrierHz: number, when?: number): void;
  dispose(): void;
}

/**
 * レイヤーごとの基準レベル（level=1 のときの出力 RMS、dBFS）。
 *
 * ソースは RMS=1.0 に正規化されているため、この値がそのまま出力 RMS になる。
 * 搬送波の RMS は −30 dBFS 設定＋等ラウドネス補正で概ね −32〜−28 dBFS なので、
 * 既定レベル（0.6 前後）で環境音がわずかに上回り、純音の耳障りさを覆う関係になる。
 */
export const LAYER_REFERENCE_DB: Partial<Record<AmbienceId, number>> = {
  brown: -22,
  pink: -24,
  air: -40,
  rain: -22,
  ocean: -22,
  forest: -22,
  fire: -22,
  // 音高を持つレイヤーは存在感が強いので、ノイズ系より控えめに置く
  pad: -26,
  bowl: -26,
  drone: -26,
};

/**
 * ミキサー値 → 線形ゲイン。
 * 指数 1.5 のテーパーでフェーダーの動きを聴感に近づける。0 は厳密に無音。
 */
export function levelToGain(level: number, referenceDb: number): number {
  if (level <= 0) return 0;
  const clamped = Math.min(level, 1);
  return Math.pow(10, referenceDb / 20) * Math.pow(clamped, 1.5);
}
