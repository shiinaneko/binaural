/**
 * 粒（グレイン）をブロック単位でバッファに焼き込む共通処理。
 *
 * 粒ごとに `BufferSource` を作る素朴な実装だと、オフラインレンダリングが壊滅的に遅くなる
 * （鳴っていない粒まで毎レンダー量子で処理されるため、60 秒の雨に 14 秒かかった）。
 * 一定長のブロックに JS で書き込んでしまえばノードは 1 本で済み、実測で 1500 倍速くなった。
 * リアルタイム側もノードの生成量が激減する。
 *
 * ブロックはセッションの絶対時刻に整列させる。分割レンダリングで途中から始めても
 * 同じ絶対時刻には同じ粒が落ちる（SPEC.md §9）。
 */

import { GrainScheduler } from '../GrainScheduler';

/** ブロック末尾からはみ出す粒のための余白。次ブロックと重ねて鳴らす（二重計上しない） */
const BLOCK_TAIL_SEC = 0.05;

export interface GrainBakerOptions {
  ctx: BaseAudioContext;
  destination: AudioNode;
  scheduler: GrainScheduler;
  /** 1 ブロックの長さ（秒） */
  blockSec: number;
  /**
   * 粒 1 つを書き込む。startSample はブロック先頭からのサンプル位置、
   * index は粒の通し番号。**パラメータは必ず index から導くこと**
   * （別の乱数列から引くと、途中から始めたときに同じ時刻の粒が別の音になる）。
   */
  writeGrain(
    left: Float32Array,
    right: Float32Array,
    startSample: number,
    index: number,
  ): void;
}

export class GrainBaker {
  private readonly ctx: BaseAudioContext;
  private readonly destination: AudioNode;
  private readonly scheduler: GrainScheduler;
  private readonly blockSec: number;
  private readonly writeGrain: GrainBakerOptions['writeGrain'];
  private readonly sources: AudioBufferSourceNode[] = [];

  private started = false;
  private startWhen = 0;
  /** 絶対時刻 → ctx 時刻のずれ */
  private timeOffset = 0;
  private nextBlockStartSec = 0;
  private stopTime = Infinity;

  constructor(opts: GrainBakerOptions) {
    this.ctx = opts.ctx;
    this.destination = opts.destination;
    this.scheduler = opts.scheduler;
    this.blockSec = opts.blockSec;
    this.writeGrain = opts.writeGrain;
  }

  start(when: number, alignSec: number): void {
    if (this.started) return;
    this.started = true;
    this.startWhen = when;
    this.timeOffset = when - alignSec;

    // 常に絶対時刻 0 から数え、担当ブロックの先頭まで空回しする
    this.scheduler.start(0);
    this.nextBlockStartSec = Math.floor(alignSec / this.blockSec) * this.blockSec;
    if (this.nextBlockStartSec > 0) this.scheduler.skipTo(this.nextBlockStartSec);
  }

  /** untilTime（ctx 時刻）までのブロックを用意する */
  pump(untilTime: number): void {
    if (!this.started) return;
    const limitAbs = Math.min(untilTime, this.stopTime) - this.timeOffset;
    while (this.nextBlockStartSec < limitAbs) {
      this.bakeBlock(this.nextBlockStartSec);
      this.nextBlockStartSec += this.blockSec;
    }
  }

  private bakeBlock(blockStartSec: number): void {
    const sr = this.ctx.sampleRate;
    const frames = Math.ceil((this.blockSec + BLOCK_TAIL_SEC) * sr);
    const buffer = this.ctx.createBuffer(2, frames, sr);
    const left = buffer.getChannelData(0);
    const right = buffer.getChannelData(1);

    this.scheduler.pump(blockStartSec + this.blockSec, (timeSec, index) => {
      this.writeGrain(left, right, Math.round((timeSec - blockStartSec) * sr), index);
    });

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.destination);

    const ctxStart = blockStartSec + this.timeOffset;
    if (ctxStart >= this.startWhen) {
      source.start(ctxStart);
    } else {
      // 描画開始がブロックの途中だった場合は、その位置から鳴らす
      source.start(this.startWhen, this.startWhen - ctxStart);
    }

    this.sources.push(source);
    source.onended = () => {
      source.disconnect();
      const index = this.sources.indexOf(source);
      if (index >= 0) this.sources.splice(index, 1);
    };
  }

  stop(when: number): void {
    this.stopTime = when;
    for (const source of this.sources) {
      try {
        source.stop(when);
      } catch {
        // すでに停止済み
      }
    }
  }

  dispose(): void {
    for (const source of this.sources) {
      try {
        source.disconnect();
      } catch {
        // すでに切断済み
      }
    }
    this.sources.length = 0;
  }
}

/**
 * 短い粒を 1 つバッファに加算する共通ルーチン。
 * 再生レートは線形補間、定位は等パワー（どちらも Web Audio のノードと同じ規則）。
 */
export function mixGrain(
  left: Float32Array,
  right: Float32Array,
  source: Float32Array,
  startSample: number,
  rate: number,
  pan: number,
  gain: number,
): void {
  const x = ((pan + 1) * Math.PI) / 4;
  const gainL = Math.cos(x) * gain;
  const gainR = Math.sin(x) * gain;
  const limit = left.length;

  for (let i = 0; ; i++) {
    const position = i * rate;
    const index = Math.floor(position);
    if (index >= source.length - 1) break;
    const out = startSample + i;
    if (out < 0) continue;
    if (out >= limit) break;

    const frac = position - index;
    const sample = source[index]! + (source[index + 1]! - source[index]!) * frac;
    left[out] += sample * gainL;
    right[out] += sample * gainR;
  }
}
