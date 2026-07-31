/**
 * 環境音レイヤーの共通土台。
 *
 * どのレイヤーも「0–1 のミキサー値 → 基準 dB(RMS) を掛けた出力ゲイン」という
 * 同じレベル制御を持つので、ここに集約する。
 * ソース側は RMS = 1.0 に正規化しておくのが約束（SPEC.md §3.3）。
 */

import type { AmbienceId } from '../types';
import { LAYER_REFERENCE_DB, levelToGain, type AmbienceLayer } from './types';

const RAMP_SEC = 0.25;

export abstract class LayerBase implements AmbienceLayer {
  readonly id: AmbienceId;
  readonly output: GainNode;

  protected readonly ctx: BaseAudioContext;
  protected readonly referenceDb: number;
  protected started = false;
  protected stopped = false;
  private levelValue = 0;

  constructor(ctx: BaseAudioContext, id: AmbienceId, fallbackReferenceDb = -22) {
    this.ctx = ctx;
    this.id = id;
    this.referenceDb = LAYER_REFERENCE_DB[id] ?? fallbackReferenceDb;
    this.output = ctx.createGain();
    this.output.gain.value = 0;
  }

  abstract start(when: number): void;
  abstract stop(when: number): void;

  setLevel(level: number, when = this.ctx.currentTime): void {
    this.levelValue = level;
    const target = levelToGain(level, this.referenceDb);
    const now = Math.max(when, this.ctx.currentTime);
    const param = this.output.gain;
    if (typeof param.cancelAndHoldAtTime === 'function') {
      param.cancelAndHoldAtTime(now);
    } else {
      param.cancelScheduledValues(now);
      param.setValueAtTime(param.value, now);
    }
    param.linearRampToValueAtTime(target, now + RAMP_SEC);
  }

  /** セグメント境界のクロスフェードのように、開始・終了時刻を厳密に決めたい場合 */
  rampLevel(level: number, startTime: number, endTime: number): void {
    this.levelValue = level;
    const target = levelToGain(level, this.referenceDb);
    this.output.gain.setValueAtTime(this.output.gain.value, startTime);
    this.output.gain.linearRampToValueAtTime(target, endTime);
  }

  get currentLevel(): number {
    return this.levelValue;
  }

  gainForLevel(level: number): number {
    return levelToGain(level, this.referenceDb);
  }

  protected disconnectAll(nodes: Array<AudioNode | undefined>): void {
    for (const node of nodes) {
      if (!node) continue;
      try {
        node.disconnect();
      } catch {
        // すでに切断済み
      }
    }
  }

  abstract dispose(): void;
}
