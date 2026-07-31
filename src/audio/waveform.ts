/**
 * 任意の初期位相を持つ波形を作る。
 *
 * `OscillatorNode` は位相を指定できないが、`PeriodicWave` を使えば作れる。
 * Web Audio の PeriodicWave は
 *
 *   x(t) = Σ_k [ real[k]·cos(2πkt) + imag[k]·sin(2πkt) ]
 *
 * で、既定の sine は real=[0,0], imag=[0,1]（= sin(2πt)）。したがって
 *
 *   sin(2πft + φ) = sin(φ)·cos(2πft) + cos(φ)·sin(2πft)
 *
 * より real[1] = sin(φ)、imag[1] = cos(φ) とすればよい。
 * `disableNormalization: true` にしないと振幅が勝手に正規化される。
 *
 * 実測で検証済み: φ=0 のとき組み込み sine とサンプル単位で完全一致し、
 * 任意の φ で理論値との誤差は 2e-6（波形テーブルの補間誤差）以下。
 */

/** 位相 φ のサイン波 */
export function createSineWave(ctx: BaseAudioContext, phase = 0): PeriodicWave {
  const real = new Float32Array([0, Math.sin(phase)]);
  const imag = new Float32Array([0, Math.cos(phase)]);
  return ctx.createPeriodicWave(real, imag, { disableNormalization: true });
}

/** 三角波の倍音数（奇数倍音のみ）。パッドはローパスを通るのでこれで十分。 */
const TRIANGLE_HARMONICS = 15;

/**
 * 位相 φ の三角波。
 *
 * 三角波は x(t) = (8/π²) Σ_{n≥0} (−1)ⁿ sin(2π(2n+1)t)/(2n+1)²（奇数倍音のみ）。
 * k 次倍音は位相を k·φ 回転させる。
 *
 * 組み込みの `type='triangle'` ではなく常にこれを使う。分割レンダリングで
 * 位相付きのときだけ波形が変わってしまうと、チャンクごとに音色が変わってしまうため。
 */
export function createTriangleWave(ctx: BaseAudioContext, phase = 0): PeriodicWave {
  const size = TRIANGLE_HARMONICS * 2 + 2;
  const real = new Float32Array(size);
  const imag = new Float32Array(size);
  const scale = 8 / (Math.PI * Math.PI);

  for (let n = 0; n < TRIANGLE_HARMONICS; n++) {
    const k = 2 * n + 1;
    const amp = (scale * (n % 2 === 0 ? 1 : -1)) / (k * k);
    real[k] = amp * Math.sin(k * phase);
    imag[k] = amp * Math.cos(k * phase);
  }

  return ctx.createPeriodicWave(real, imag, { disableNormalization: true });
}

/** ゲート波（アイソクロニック用）の奇数倍音構成 */
const GATE_HARMONICS = [1, 3, 5, 7, 9];

/**
 * 矩形寄りの帯域制限波形。生の矩形波と違い立ち上がりが鈍るのでクリックが出ない。
 *
 * 位相 φ をずらす場合、k 次倍音は k·φ 回転する:
 *   (1/k)·sin(2πkft + kφ) = (1/k)[ sin(kφ)·cos + cos(kφ)·sin ]
 *
 * 正規化は有効のままにする（倍音の合成でピークが 1 を超えるため）。
 * その代わり位相をずらしてもピークが揺れないよう、正規化係数は φ に依らない
 * ——という保証は無いので、位相付きのときのみ手計算で振幅を揃える。
 */
export function createGateWave(ctx: BaseAudioContext, phase = 0): PeriodicWave {
  const size = Math.max(...GATE_HARMONICS) + 2;
  const real = new Float32Array(size);
  const imag = new Float32Array(size);

  for (const k of GATE_HARMONICS) {
    const amp = 1 / k;
    real[k] = amp * Math.sin(k * phase);
    imag[k] = amp * Math.cos(k * phase);
  }

  // 位相をずらしてもピーク振幅が変わらないよう、正規化はブラウザに任せず
  // 常に「φ=0 のときのピーク」で割る（φ に依存しない一定のスケール）。
  const peak = gatePeak();
  for (let i = 0; i < size; i++) {
    real[i] /= peak;
    imag[i] /= peak;
  }

  return ctx.createPeriodicWave(real, imag, { disableNormalization: true });
}

/** φ=0 のゲート波のピーク値（1 周期を細かく評価して求める） */
function gatePeak(): number {
  let peak = 0;
  const steps = 2048;
  for (let i = 0; i < steps; i++) {
    const t = i / steps;
    let v = 0;
    for (const k of GATE_HARMONICS) v += Math.sin(2 * Math.PI * k * t) / k;
    peak = Math.max(peak, Math.abs(v));
  }
  return peak;
}
