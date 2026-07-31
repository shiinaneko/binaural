/**
 * 等ラウドネス補正（SPEC.md §3.1）。
 *
 * 低い搬送波は同じ振幅でも小さく聞こえるため、搬送波周波数に応じてゲインを持ち上げる。
 * ISO 226 の 40 phon 曲線を近似したテーブルを、対数周波数軸上で線形補間する。
 * 400 Hz を 0 dB の基準とする。実測で微調整する前提の初期値。
 */

const TABLE_HZ = [80, 120, 160, 200, 250, 315, 400, 500, 600] as const;
const TABLE_DB = [13.0, 9.5, 7.0, 5.0, 3.0, 1.5, 0.0, -0.5, -1.0] as const;

/**
 * 搬送波周波数に対する補正量（dB）。テーブル範囲外は端の値でクランプする。
 * 周波数の知覚は対数的なので log2(f) 上で補間する。
 */
export function equalLoudnessGainDb(carrierHz: number): number {
  const first = TABLE_HZ[0];
  const last = TABLE_HZ[TABLE_HZ.length - 1]!;
  if (carrierHz <= first) return TABLE_DB[0];
  if (carrierHz >= last) return TABLE_DB[TABLE_DB.length - 1]!;

  for (let i = 0; i < TABLE_HZ.length - 1; i++) {
    const f0 = TABLE_HZ[i]!;
    const f1 = TABLE_HZ[i + 1]!;
    if (carrierHz <= f1) {
      const d0 = TABLE_DB[i]!;
      const d1 = TABLE_DB[i + 1]!;
      const u = (Math.log2(carrierHz) - Math.log2(f0)) / (Math.log2(f1) - Math.log2(f0));
      return d0 + (d1 - d0) * u;
    }
  }
  return TABLE_DB[TABLE_DB.length - 1]!;
}

export function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

export function gainToDb(gain: number): number {
  return 20 * Math.log10(Math.max(gain, 1e-9));
}

/**
 * 搬送波の最終ゲイン（線形）。指定レベルに等ラウドネス補正を足したもの。
 * 補正で持ち上がりすぎないよう −6 dBFS を上限にする。
 */
export function carrierGain(gainDb: number, carrierHz: number): number {
  const db = Math.min(gainDb + equalLoudnessGainDb(carrierHz), -6);
  return dbToGain(db);
}

/** テーブルの生データ（テストと UI の表示用） */
export const LOUDNESS_TABLE = TABLE_HZ.map((hz, i) => ({ hz, db: TABLE_DB[i]! }));
