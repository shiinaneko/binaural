/**
 * シンギングボウルレイヤー（SPEC.md §3.3）。
 *
 * 加算合成。倍音比を非整数（1 : 2.71 : 5.18 : 8.4）にすることで、
 * ピッチの定まらない金属的な響きになる。各 partial はごくわずかに周波数の違う
 * 2 本のペアで鳴らし、実物のボウルのようなゆっくりしたうねりを作る。
 *
 * **搬送波との干渉を避ける音高の置き方**（パッドと同じ考え方）:
 * 基音を fc の 0.5 倍に置くと、partial は fc の 0.5 / 1.355 / 2.59 / 4.2 倍になり、
 * どれも 1.0fc に一致しない。最も近い 1.355fc でも fc から 35% 離れているので、
 * 搬送波とのうなりは生じない。
 */

import { dbToGain } from '../loudness';
import { mulberry32 } from '../prng';
import { LayerBase } from './base';

/** 実物のボウルに近い非整数の倍音比 */
const PARTIALS = [
  { ratio: 1.0, amp: 1.0, decaySec: 20 },
  { ratio: 2.71, amp: 0.5, decaySec: 12 },
  { ratio: 5.18, amp: 0.24, decaySec: 7 },
  { ratio: 8.4, amp: 0.1, decaySec: 4 },
];

/** ペアの周波数差（比率）。うねりの速さが音高に比例する */
const PAIR_DETUNE = 0.0015;
/** 基音の位置（搬送波に対する比） */
const ROOT_RATIO = 0.5;

const STRIKE_MIN_SEC = 30;
const STRIKE_RANGE_SEC = 20;
const ATTACK_SEC = 0.008;
/**
 * ボウルは 30〜50 秒に一度しか鳴らない断続音なので、他のレイヤーのように
 * 長時間 RMS で揃えると 1 打鍵が過大になる（実測で 32 dB ぶんの差が出た）。
 * ここでは **打鍵のピーク**が他のレイヤーの level=1 のピーク（約 0.35）と
 * 揃うように校正している。
 */
const INTERNAL_TRIM = 7.8;

/** 最も長い partial の減衰。書き出しのプリロールをこの長さに合わせる必要がある。 */
export const BOWL_TAIL_SEC = Math.max(...PARTIALS.map((p) => p.decaySec));

export class BowlLayer extends LayerBase {
  private readonly bus: GainNode;
  private readonly rand: () => number;
  private readonly alignSec: number;
  private tonalCenterHz: number;
  private startWhen = 0;
  private timeOffset = 0;
  private nextStrikeSec = 0;
  private stopTime = Infinity;
  private readonly active: AudioNode[] = [];

  constructor(ctx: BaseAudioContext, seed: number, carrierHz = 240, alignSec = 0) {
    super(ctx, 'bowl');
    this.alignSec = alignSec;
    this.tonalCenterHz = carrierHz;
    this.rand = mulberry32((seed ^ 0x1f83d9ab) >>> 0);

    this.bus = ctx.createGain();
    this.bus.gain.value = INTERNAL_TRIM;
    this.bus.connect(this.output);
  }

  start(when: number): void {
    if (this.started) return;
    this.started = true;
    this.startWhen = when;
    this.timeOffset = when - this.alignSec;

    // 打鍵の時刻は絶対時刻 0 から数える。分割レンダリングで途中から始めても同じ並びになる。
    this.nextStrikeSec = 0;
    while (this.nextStrikeSec < this.alignSec) {
      this.nextStrikeSec += STRIKE_MIN_SEC + this.rand() * STRIKE_RANGE_SEC;
    }
  }

  stop(when: number): void {
    if (!this.started || this.stopped) return;
    this.stopped = true;
    this.stopTime = when;
  }

  pump(untilTime: number): void {
    if (!this.started) return;
    const limitAbs = Math.min(untilTime, this.stopTime) - this.timeOffset;
    while (this.nextStrikeSec < limitAbs) {
      this.strike(this.nextStrikeSec + this.timeOffset);
      this.nextStrikeSec += STRIKE_MIN_SEC + this.rand() * STRIKE_RANGE_SEC;
    }
  }

  /** 1 打鍵ぶんのノードを組む。鳴り終わったら自分で外れる。 */
  private strike(at: number): void {
    const when = Math.max(at, this.startWhen);
    const root = this.tonalCenterHz * ROOT_RATIO;

    for (const partial of PARTIALS) {
      for (const side of [-1, 1]) {
        const osc = this.ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = partial.ratio * root * (1 + side * PAIR_DETUNE);

        const gain = this.ctx.createGain();
        const peak = dbToGain(-6) * partial.amp * 0.5;
        gain.gain.setValueAtTime(0.0001, when);
        gain.gain.linearRampToValueAtTime(peak, when + ATTACK_SEC);
        gain.gain.exponentialRampToValueAtTime(peak * 0.001, when + partial.decaySec);

        osc.connect(gain).connect(this.bus);
        osc.start(when);
        osc.stop(when + partial.decaySec + 0.05);
        this.active.push(osc, gain);
        osc.onended = () => {
          osc.disconnect();
          gain.disconnect();
        };
      }
    }
  }

  setTonalCenterHz(carrierHz: number): void {
    // 次の打鍵から新しい音高になる（鳴っている響きの音程は変えない）
    this.tonalCenterHz = carrierHz;
  }

  /** 検証・表示用 */
  get partialFrequencies(): number[] {
    return PARTIALS.map((p) => p.ratio * this.tonalCenterHz * ROOT_RATIO);
  }

  dispose(): void {
    this.disconnectAll([...this.active, this.bus, this.output]);
    this.active.length = 0;
  }
}
