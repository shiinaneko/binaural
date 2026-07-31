/**
 * 搬送波の周波数スケジュールを、純関数としてブレークポイント列に落とす。
 *
 * ここを純関数にしておくのが Phase 4（WAV 書き出し）の土台になる。
 * リアルタイム再生はこの列を AudioParam に流し込み、
 * 分割レンダリングは同じ列を積分して「チャンク境界での累積位相」を求める。
 * 両者が同じ関数を通ることで、書き出したファイルと再生音が食い違わない。
 */

import { beatHzAt, toRampSteps } from './BeatCurve';
import type { Breakpoint } from './breakpoints';
import type { BeatCurve, BeatMode } from './types';

export interface CarrierBreakpoints {
  left: Breakpoint[];
  right: Breakpoint[];
  /** AM（アイソクロニック／ハイブリッド）のゲート周波数 */
  am: Breakpoint[];
}

/** 搬送波を fc ∓ Δf/2 に開く度合い。アイソクロニックは単一搬送波なので 0。 */
export function spreadForMode(mode: BeatMode): number {
  return mode === 'isochronic' ? 0 : 1;
}

/** 搬送波グライドの分割数の上限（自動化イベントを増やしすぎない） */
const MAX_GLIDE_DIVISIONS = 200;
const GLIDE_STEP_SEC = 0.5;

export interface SegmentCarrierInput {
  /** すでに境界の橋渡し（bridgeCurve）を適用済みのカーブ */
  curve: BeatCurve;
  fromCarrierHz: number;
  toCarrierHz: number;
  carrierGlideSec: number;
  spread: number;
}

/**
 * 1 セグメントぶんのブレークポイントを作る。
 *
 * 時間グリッドは「カーブの点」と「搬送波グライドの分割点」の和集合。
 * 値は beatHzAt から取るので、smooth 補間の S 字がそのまま反映される。
 */
export function buildSegmentBreakpoints(input: SegmentCarrierInput): CarrierBreakpoints {
  const { curve, fromCarrierHz, toCarrierHz, spread } = input;
  const glideSec = toCarrierHz === fromCarrierHz ? 0 : Math.max(input.carrierGlideSec, 0);

  const times = new Set<number>(toRampSteps(curve).map((s) => s.t));
  if (glideSec > 0) {
    const divisions = Math.min(Math.ceil(glideSec / GLIDE_STEP_SEC), MAX_GLIDE_DIVISIONS);
    for (let i = 0; i <= divisions; i++) times.add((glideSec * i) / divisions);
  }
  const grid = [...times].sort((a, b) => a - b);

  const carrierAt = (t: number): number =>
    glideSec > 0
      ? fromCarrierHz + (toCarrierHz - fromCarrierHz) * Math.min(t / glideSec, 1)
      : toCarrierHz;

  const left: Breakpoint[] = [];
  const right: Breakpoint[] = [];
  const am: Breakpoint[] = [];

  for (const t of grid) {
    const hz = beatHzAt(curve, t);
    const fc = carrierAt(t);
    left.push({ t, value: fc - (spread * hz) / 2 });
    right.push({ t, value: fc + (spread * hz) / 2 });
    am.push({ t, value: Math.max(hz, 0.01) });
  }

  return { left, right, am };
}
