import type { AmbienceId } from '../types';
import { BowlLayer } from './bowl';
import { DroneLayer } from './drone';
import { FireLayer } from './fire';
import { ForestLayer } from './forest';
import { NoiseLayer } from './noise';
import { OceanLayer } from './ocean';
import { PadLayer } from './pad';
import { RainLayer } from './rain';
import type { AmbienceLayer } from './types';

export { BowlLayer, BOWL_TAIL_SEC } from './bowl';
export { DroneLayer } from './drone';
export { FireLayer } from './fire';
export { ForestLayer } from './forest';
export { NoiseLayer, createNoiseBuffer } from './noise';
export { OceanLayer } from './ocean';
export { PadLayer } from './pad';
export { RainLayer } from './rain';
export type { AmbienceLayer } from './types';
export { levelToGain, LAYER_REFERENCE_DB } from './types';

/** 実装済みのレイヤー。Phase 5 で全 11 種が揃った。 */
export const IMPLEMENTED_AMBIENCES: readonly AmbienceId[] = [
  'none',
  'brown',
  'pink',
  'air',
  'rain',
  'ocean',
  'pad',
  'forest',
  'fire',
  'bowl',
  'drone',
];

/**
 * レイヤーの余韻の長さ（秒）。分割書き出しのプリロールをこれに合わせる必要がある
 * （チャンクの手前で始まった音の尾を拾うため）。
 */
export const LAYER_TAIL_SEC: Partial<Record<AmbienceId, number>> = {
  bowl: 20,
};

export const AMBIENCE_LABELS: Record<AmbienceId, string> = {
  none: '純音のみ',
  brown: 'ブラウンノイズ',
  pink: 'ピンクノイズ',
  rain: '雨',
  ocean: '波',
  forest: '森と小川',
  fire: '焚き火',
  pad: '温かいパッド',
  bowl: 'シンギングボウル',
  drone: 'ドローン',
  air: '部屋の空気感',
};

export const AMBIENCE_DESCRIPTIONS: Record<AmbienceId, string> = {
  none: '搬送波だけ。ビートを最もはっきり感じられる',
  brown: '低域寄りの落ち着いたノイズ。長時間でも疲れにくい',
  pink: '自然界に近いバランスのノイズ',
  rain: '雨音。低域の芯・面としての雨・滴の粒の 3 層',
  ocean: '波。寄せて引くときに音が暗くなる',
  forest: '小川のせせらぎと、ゆっくり揺れる葉擦れ',
  fire: '焚き火。まとまって弾けるパチパチ',
  pad: '温かい持続音。搬送波と協和する音高に自動で合わせる',
  bowl: 'シンギングボウル。30〜50 秒ごとに打たれ、長く尾を引く',
  drone: '深く沈むドローン。120 秒周期で緩慢に表情が変わる',
  air: 'ごく薄い空気感。生活音を軽くマスクする',
};

export interface CreateLayerOptions {
  /** 音高を持つレイヤー（パッド）が協和する音高を決めるために使う */
  carrierHz?: number;
  /**
   * 分割レンダリングで、このレイヤーが担当する絶対時刻の起点（秒）。
   *
   * ノイズのループ位置・LFO の位相・粒の並びをこの時刻に整列させる。
   * こうするとチャンクをまたいでも同じ絶対時刻には同じ音が生成され、
   * 境界の重なり部分が一致する（SPEC.md §9）。リアルタイム再生では 0。
   */
  alignSec?: number;
  /**
   * alignSec の時点における、音高中心（ratio=1）の累積位相（ラジアン）。
   * パッドの声はこれに音高比を掛けた位相から始める。
   *
   * **[0, 2π) に畳まずに渡すこと。** 声ごとに比を掛けてから畳む必要があり、
   * 先に畳むと wrap(φ)×比 ≠ wrap(φ×比) で位相が壊れる。
   */
  tonalPhase?: number;
}

/**
 * レイヤーを生成する。未実装の ID では null を返す（呼び出し側で無視する）。
 * seed はプリセットのシードにレイヤーごとのオフセットを足して渡す。
 */
export function createAmbienceLayer(
  ctx: BaseAudioContext,
  id: AmbienceId,
  seed: number,
  opts: CreateLayerOptions = {},
): AmbienceLayer | null {
  const alignSec = opts.alignSec ?? 0;
  switch (id) {
    case 'brown':
      return new NoiseLayer(ctx, { id, color: 'brown', seed, lowpassHz: 2000, alignSec });
    case 'pink':
      return new NoiseLayer(ctx, { id, color: 'pink', seed, alignSec });
    case 'air':
      return new NoiseLayer(ctx, { id, color: 'pink', seed, highpassHz: 500, alignSec });
    case 'rain':
      return new RainLayer(ctx, seed, alignSec);
    case 'ocean':
      return new OceanLayer(ctx, seed, alignSec);
    case 'forest':
      return new ForestLayer(ctx, seed, alignSec);
    case 'fire':
      return new FireLayer(ctx, seed, alignSec);
    case 'pad':
      return new PadLayer(ctx, seed, opts.carrierHz, alignSec, opts.tonalPhase ?? 0);
    case 'bowl':
      return new BowlLayer(ctx, seed, opts.carrierHz, alignSec);
    case 'drone':
      return new DroneLayer(ctx, seed, opts.carrierHz, alignSec, opts.tonalPhase ?? 0);
    default:
      return null;
  }
}
