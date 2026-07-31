/**
 * 搬送波の周波数計算（SPEC.md §3.1）。
 *
 *   left  = fc − Δf/2
 *   right = fc + Δf/2
 *
 * 左右の差がちょうど Δf になることが、この音の存在意義そのものなので、
 * 計算はここに集約して単体テストで固定する。
 */

import type { Band } from './types';
import { BEAT_MAX_HZ, BEAT_MIN_HZ, CARRIER_MAX_HZ, CARRIER_MIN_HZ, SIDE_MIN_HZ } from './types';

export interface SideFrequencies {
  left: number;
  right: number;
}

export function sideFrequencies(carrierHz: number, beatHz: number): SideFrequencies {
  const half = beatHz / 2;
  return { left: carrierHz - half, right: carrierHz + half };
}

export function clampCarrierHz(hz: number): number {
  return Math.min(Math.max(hz, CARRIER_MIN_HZ), CARRIER_MAX_HZ);
}

export function clampBeatHz(hz: number): number {
  return Math.min(Math.max(hz, BEAT_MIN_HZ), BEAT_MAX_HZ);
}

/** その Δf を鳴らすために最低限必要な搬送波周波数（左チャンネルが SIDE_MIN_HZ を下回らない下限） */
export function minCarrierForBeat(beatHz: number): number {
  return SIDE_MIN_HZ + beatHz / 2;
}

/** fc と Δf の組み合わせが許容範囲か。UI で禁止する組み合わせの判定に使う。 */
export function isValidPair(carrierHz: number, beatHz: number): boolean {
  if (carrierHz < CARRIER_MIN_HZ || carrierHz > CARRIER_MAX_HZ) return false;
  if (beatHz < BEAT_MIN_HZ || beatHz > BEAT_MAX_HZ) return false;
  return sideFrequencies(carrierHz, beatHz).left >= SIDE_MIN_HZ;
}

/** Δf から帯域名を引く（表示用） */
export function bandForBeatHz(hz: number): Band {
  if (hz < 4) return 'delta';
  if (hz < 8) return 'theta';
  if (hz < 12) return 'alpha';
  if (hz < 15) return 'smr';
  if (hz < 30) return 'beta';
  return 'gamma';
}

export const BAND_LABELS: Record<Band, string> = {
  delta: 'デルタ',
  theta: 'シータ',
  alpha: 'アルファ',
  smr: 'SMR',
  beta: 'ベータ',
  gamma: 'ガンマ',
};
