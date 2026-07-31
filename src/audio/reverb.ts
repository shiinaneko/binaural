/**
 * 実行時生成のインパルス応答（SPEC.md §3.4）。
 *
 * 音源ファイルを持たない方針なので、IR もその場で合成する。
 * ノイズバースト × 指数減衰、左右は非相関、高域は減衰を速くして自然な暗さを作る。
 *
 * **この畳み込みは環境音バスにのみ挿入する。** 搬送波バスに通すと左右の位相関係が
 * 壊れ、バイノーラルビートが成立しなくなる。
 */

import { mulberry32 } from './prng';

export interface ImpulseResponseOptions {
  /** −60 dB に達するまでの時間（秒） */
  decaySec?: number;
  /** 初期反射までの無音（秒） */
  preDelaySec?: number;
  /** 高域の減衰。この周波数以上は減衰が速くなる */
  dampingHz?: number;
  seed?: number;
}

/** 1 極ローパスの係数を周波数から作る */
function onePoleCoeff(cutoffHz: number, sampleRate: number): number {
  return Math.exp((-2 * Math.PI * cutoffHz) / sampleRate);
}

export function createImpulseResponse(
  ctx: BaseAudioContext,
  opts: ImpulseResponseOptions = {},
): AudioBuffer {
  const decaySec = opts.decaySec ?? 2.6;
  const preDelaySec = opts.preDelaySec ?? 0.012;
  const dampingHz = opts.dampingHz ?? 8000;
  const seed = opts.seed ?? 0x5eed;

  const sr = ctx.sampleRate;
  const length = Math.max(1, Math.floor((decaySec + preDelaySec) * sr));
  const buffer = ctx.createBuffer(2, length, sr);

  const preDelay = Math.floor(preDelaySec * sr);
  // 減衰係数: decaySec で振幅が 10^-3（−60 dB）になるように
  const k = Math.log(1000) / (decaySec * sr);
  const lpCoeff = onePoleCoeff(dampingHz, sr);
  // 立ち上がりの 5 ms はフェードインさせる（頭のクリックを避ける）
  const attack = Math.floor(0.005 * sr);

  for (let ch = 0; ch < 2; ch++) {
    const rand = mulberry32(seed + ch * 0x85ebca6b);
    const data = buffer.getChannelData(ch);
    let lp = 0;

    for (let i = preDelay; i < length; i++) {
      const n = i - preDelay;
      const white = rand() * 2 - 1;
      // 1 極ローパスで高域を落とす（材質の吸音に相当）
      lp = white * (1 - lpCoeff) + lp * lpCoeff;
      const envelope = Math.exp(-k * n);
      const fadeIn = n < attack ? n / attack : 1;
      data[i] = lp * envelope * fadeIn;
    }

    // sum(h^2) = 1 に正規化して、畳み込みのゲインをユニティ（RMS 基準）にする。
    // これをやらないと減衰時間を変えるたびにリバーブの音量が変わってしまう。
    let energy = 0;
    for (let i = 0; i < length; i++) energy += data[i] * data[i];
    if (energy > 0) {
      const norm = 1 / Math.sqrt(energy);
      for (let i = 0; i < length; i++) data[i] = data[i] * norm;
    }
  }

  return buffer;
}
