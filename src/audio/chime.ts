/**
 * 区切りのチャイム（SPEC.md §4.4）。
 * 加算合成のベル。4 partial を非整数比で重ね、指数減衰させる。
 * 立ち上がりに 5 ms のランプを入れてクリックを防ぐ。
 */

import { dbToGain } from './loudness';

interface Partial {
  ratio: number;
  amp: number;
  decaySec: number;
}

const PARTIALS: Partial[] = [
  { ratio: 1.0, amp: 1.0, decaySec: 2.5 },
  { ratio: 2.01, amp: 0.5, decaySec: 1.6 },
  { ratio: 3.01, amp: 0.28, decaySec: 1.0 },
  { ratio: 4.16, amp: 0.16, decaySec: 0.7 },
];

const ATTACK_SEC = 0.005;

export interface ChimeOptions {
  /** 基音（Hz）。既定は柔らかく通る G5 付近 */
  fundamentalHz?: number;
  gainDb?: number;
}

/**
 * when（AudioContext 時間）にチャイムを鳴らす。
 * 使い捨てノードなので、鳴り終わったあとは GC に任せる。
 */
export function scheduleChime(
  ctx: BaseAudioContext,
  destination: AudioNode,
  when: number,
  opts: ChimeOptions = {},
): void {
  const fundamental = opts.fundamentalHz ?? 784;
  const master = dbToGain(opts.gainDb ?? -26);

  for (const p of PARTIALS) {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = fundamental * p.ratio;

    const gain = ctx.createGain();
    const peak = master * p.amp;
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.linearRampToValueAtTime(peak, when + ATTACK_SEC);
    gain.gain.exponentialRampToValueAtTime(peak * 0.0001, when + p.decaySec);

    osc.connect(gain).connect(destination);
    osc.start(when);
    osc.stop(when + p.decaySec + 0.05);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
  }
}

/** チャイムが鳴り終わるまでの長さ（スケジューリングの余白計算用） */
export const CHIME_TAIL_SEC = Math.max(...PARTIALS.map((p) => p.decaySec)) + 0.1;
