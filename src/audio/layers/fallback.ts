/**
 * 未実装レイヤーの代替（Phase 1 の暫定措置）。
 *
 * プリセットの定義は SPEC.md §4.3 のまま保ち、まだ実装していないレイヤーだけを
 * 近いノイズで置き換える。UI には「代替中」であることを明示する。
 * レイヤーが実装されたらこのテーブルから該当行を消すだけでよい。
 */

import type { AmbienceId, AmbienceMix } from '../types';
import { IMPLEMENTED_AMBIENCES } from './index';

/**
 * 未実装 ID → [代替 ID, レベル倍率]
 *
 * Phase 5 で全 11 種が実装済みになったため、現在この表は空。
 * 新しいレイヤーを構想して先にプリセットへ書いた場合に、ここへ一時的に登録する。
 */
const SUBSTITUTIONS: Partial<Record<AmbienceId, [AmbienceId, number]>> = {};

export interface ResolvedMix {
  mix: AmbienceMix;
  substitutions: Array<{ from: AmbienceId; to: AmbienceId }>;
}

export function isImplemented(id: AmbienceId): boolean {
  return IMPLEMENTED_AMBIENCES.includes(id);
}

/** ミックス中の未実装レイヤーを代替に置き換える。合成後のレベルは加算し 1 でクランプ。 */
export function resolveAmbienceMix(mix: AmbienceMix): ResolvedMix {
  const layers: Partial<Record<AmbienceId, number>> = {};
  const substitutions: Array<{ from: AmbienceId; to: AmbienceId }> = [];

  for (const [rawId, level] of Object.entries(mix.layers) as Array<[AmbienceId, number]>) {
    if (!level || level <= 0) continue;

    if (isImplemented(rawId)) {
      layers[rawId] = Math.min(1, (layers[rawId] ?? 0) + level);
      continue;
    }

    const sub = SUBSTITUTIONS[rawId];
    if (!sub) continue;
    const [toId, scale] = sub;
    layers[toId] = Math.min(1, (layers[toId] ?? 0) + level * scale);
    substitutions.push({ from: rawId, to: toId });
  }

  return { mix: { ...mix, layers }, substitutions };
}
