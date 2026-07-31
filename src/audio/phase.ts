/**
 * 累積位相の計算（Phase 4 の分割レンダリングの心臓部）。
 *
 * 25 分を一括でレンダリングすると 576 MB、ポモドーロ 135 分では 3.1 GB になり
 * ヒープに載らない。そこで 5 分ずつに分けて描画するのだが、
 * `OscillatorNode` は毎回位相 0 から始まるため、素朴に繋ぐと境界で位相が飛んでクリックになる。
 *
 * 対策は 2 つ:
 * 1. 各チャンクの開始時刻における累積位相 φ を解析的に求める（このファイル）
 * 2. その位相を持つサイン波を `PeriodicWave` で作る（waveform.ts）
 *
 * 位相は φ(T) = 2π ∫₀^T f(t) dt。周波数の自動化は区分線形なので台形則で厳密に積分できる。
 * Web Audio 側もサンプル毎に線形補間した周波数を積算するため、これは実装の挙動と一致する。
 */

import { integrate, type Breakpoint } from './breakpoints';

const TWO_PI = Math.PI * 2;

/** 周波数列を [0, untilSec] で積分した累積位相（ラジアン、非ラップ） */
export function integratePhase(points: Breakpoint[], untilSec: number): number {
  return TWO_PI * integrate(points, untilSec);
}

/** 位相を [0, 2π) に畳む。大きな累積値をそのまま渡すと精度が落ちるため。 */
export function wrapPhase(phase: number): number {
  const wrapped = phase % TWO_PI;
  return wrapped < 0 ? wrapped + TWO_PI : wrapped;
}

/** 2 つの位相の差を [−π, π] に正規化して返す（境界の連続性の検証用） */
export function phaseDifference(a: number, b: number): number {
  let diff = (a - b) % TWO_PI;
  if (diff > Math.PI) diff -= TWO_PI;
  if (diff < -Math.PI) diff += TWO_PI;
  return diff;
}
