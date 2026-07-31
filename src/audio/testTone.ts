/**
 * ヘッドホンチェック用のテスト音（SPEC.md §7.1-5）。
 *
 * 「左だけ / 右だけ」で装着と左右の向きを確認し、Δf 6 Hz で
 * うなりが実際に聞こえるか（=バイノーラルが機能しているか）を確認する。
 */

import { dbToGain } from './loudness';
import { sideFrequencies } from './carrier';

export type TestSide = 'left' | 'right' | 'both';

export interface TestToneHandle {
  stop(fadeSec?: number): void;
}

export interface TestToneOptions {
  side: TestSide;
  carrierHz?: number;
  /** both のときのみ有効。0 なら左右同じ周波数（うなりなし） */
  beatHz?: number;
  gainDb?: number;
}

const FADE_SEC = 0.05;

export function playTestTone(ctx: AudioContext, opts: TestToneOptions): TestToneHandle {
  const carrierHz = opts.carrierHz ?? 240;
  const beatHz = opts.side === 'both' ? (opts.beatHz ?? 0) : 0;
  const { left, right } = sideFrequencies(carrierHz, beatHz);

  const merger = ctx.createChannelMerger(2);
  const out = ctx.createGain();
  out.gain.value = 0;
  merger.connect(out).connect(ctx.destination);

  const oscs: OscillatorNode[] = [];
  const now = ctx.currentTime;

  const addOsc = (freq: number, channel: 0 | 1) => {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;
    osc.connect(merger, 0, channel);
    osc.start(now);
    oscs.push(osc);
  };

  if (opts.side === 'left' || opts.side === 'both') addOsc(left, 0);
  if (opts.side === 'right' || opts.side === 'both') addOsc(right, 1);

  const target = dbToGain(opts.gainDb ?? -26);
  out.gain.setValueAtTime(0, now);
  out.gain.linearRampToValueAtTime(target, now + FADE_SEC);

  let stopped = false;
  return {
    stop(fadeSec = FADE_SEC) {
      if (stopped) return;
      stopped = true;
      const t = ctx.currentTime;
      out.gain.cancelScheduledValues(t);
      out.gain.setValueAtTime(out.gain.value, t);
      out.gain.linearRampToValueAtTime(0, t + fadeSec);
      for (const osc of oscs) {
        osc.stop(t + fadeSec + 0.02);
        osc.onended = () => osc.disconnect();
      }
      setTimeout(
        () => {
          merger.disconnect();
          out.disconnect();
        },
        (fadeSec + 0.1) * 1000,
      );
    },
  };
}
