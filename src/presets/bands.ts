/**
 * 帯域の定義（SPEC.md §3.1 の表）。
 *
 * 搬送波はビート知覚が最も明瞭な 200–500 Hz 付近を軸に、帯域が低いほど低く取る。
 * Gamma はビートレートが高くバイノーラルでの知覚が弱いため、AM 併用を推奨する。
 */

import type { BandSpec } from '../audio/types';

export const BANDS: BandSpec[] = [
  {
    id: 'delta',
    label: 'デルタ',
    minHz: 0.5,
    maxHz: 4,
    defaultBeatHz: 2.0,
    defaultCarrierHz: 160,
    preferAm: false,
    note: '深い休息・入眠前。低域なのでヘッドホンの再生能力に左右される',
  },
  {
    id: 'theta',
    label: 'シータ',
    minHz: 4,
    maxHz: 8,
    defaultBeatHz: 6.0,
    defaultCarrierHz: 200,
    preferAm: false,
    note: '瞑想・内省。7.83 Hz（シューマン共振）もこの帯域',
  },
  {
    id: 'alpha',
    label: 'アルファ',
    minHz: 8,
    maxHz: 12,
    defaultBeatHz: 10.0,
    defaultCarrierHz: 240,
    preferAm: false,
    note: 'リラックスした覚醒・読書',
  },
  {
    id: 'smr',
    label: 'SMR',
    minHz: 12,
    maxHz: 15,
    defaultBeatHz: 14.0,
    defaultCarrierHz: 280,
    preferAm: false,
    note: '静かな集中。長時間の作業に向く',
  },
  {
    id: 'beta',
    label: 'ベータ',
    minHz: 15,
    maxHz: 24,
    defaultBeatHz: 16.0,
    defaultCarrierHz: 320,
    preferAm: false,
    note: '能動的な集中・処理速度',
  },
  {
    id: 'gamma',
    label: 'ガンマ',
    minHz: 35,
    maxHz: 45,
    defaultBeatHz: 40.0,
    defaultCarrierHz: 400,
    preferAm: true,
    note: '純バイノーラルでは知覚が弱い帯域。アイソクロニック（AM）を既定にする',
  },
];

export const BAND_BY_ID = Object.fromEntries(BANDS.map((b) => [b.id, b])) as Record<
  BandSpec['id'],
  BandSpec
>;
