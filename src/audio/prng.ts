/**
 * シード付き擬似乱数。
 *
 * ノイズバッファと粒（雨・焚き火）の生成に使う。同じシードなら常に同じ音になるので、
 * リアルタイム再生と WAV 書き出しで結果が一致する（SPEC.md §9）。
 */

/** mulberry32 — 32bit シード、周期 2^32、十分に高速で分布も素直 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** −1..1 の一様乱数を返す（ホワイトノイズ用） */
export function bipolar(rand: () => number): number {
  return rand() * 2 - 1;
}

/** 文字列からシードを作る（プリセット ID → 再現可能なシード） */
export function seedFromString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
