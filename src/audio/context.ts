/**
 * リアルタイム再生とオフライン書き出しの違いを吸収するための判定。
 *
 * グラフの構築コードは両方で共通にしているが、スケジューリングの戦略だけは変える必要がある:
 *
 * - リアルタイム: currentTime が進むので、少し先までを繰り返し予約する（先読み）。
 *   25 分先の雨粒まで一度に作ると、数万個のノードを一気に生成してしまう。
 * - オフライン: レンダリング開始まで currentTime が 0 のまま動かず、
 *   tick を回す機会がない。全長ぶんを最初に予約しきる必要がある。
 */
export function isOfflineContext(ctx: BaseAudioContext): boolean {
  return typeof (ctx as OfflineAudioContext).startRendering === 'function';
}
