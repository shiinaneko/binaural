/**
 * バッファに直接かける小さな DSP。
 *
 * 粒（雨粒など）はフィルタまで JS 側で焼き込んでおく。毎秒数十個の粒に
 * BiquadFilterNode を割り当てるとノード数が嵌まらないため、
 * 短いバッファの生成時に一度だけ処理しておく。
 */

/** RBJ バンドパス（ピークゲイン 0 dB）を直接形 I で適用する */
export function applyBandpass(
  data: Float32Array,
  sampleRate: number,
  centerHz: number,
  q: number,
): void {
  const w0 = (2 * Math.PI * centerHz) / sampleRate;
  const alpha = Math.sin(w0) / (2 * q);
  const cosW0 = Math.cos(w0);

  const a0 = 1 + alpha;
  const b0 = alpha / a0;
  const b1 = 0;
  const b2 = -alpha / a0;
  const a1 = (-2 * cosW0) / a0;
  const a2 = (1 - alpha) / a0;

  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < data.length; i++) {
    const x0 = data[i];
    const y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
    data[i] = y0;
  }
}

/** ピーク値を target に合わせる（0 なら何もしない） */
export function normalizePeak(data: Float32Array, target: number): void {
  let peak = 0;
  for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
  if (peak <= 0) return;
  const scale = target / peak;
  for (let i = 0; i < data.length; i++) data[i] = data[i] * scale;
}

/** RMS を返す（レベル校正の実測に使う） */
export function rms(data: Float32Array): number {
  let energy = 0;
  for (let i = 0; i < data.length; i++) energy += data[i] * data[i];
  return Math.sqrt(energy / data.length);
}
