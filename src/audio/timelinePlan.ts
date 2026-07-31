/**
 * タイムライン全体を「絶対時間の自動化プラン」に変換する純関数。
 *
 * SessionScheduler はリアルタイム用に、時間が進むにつれて少しずつ予約していく。
 * 一方 WAV 書き出しは「セッションの途中の 5 分間」だけを切り出して描画する必要があり、
 * 途中から始めるには全体を見渡した表が要る。それがこのプラン。
 *
 * SessionScheduler と同じ規則（bridgeCurve、SEGMENT_CROSSFADE_SEC、
 * 等ラウドネス補正、フェード）をここでも通す。両者が一致することは
 * tests/timelinePlan.test.ts でスケジューラの予約内容と突き合わせて検証している。
 */

import { beatHzAt, bridgeCurve, curveDurationSec } from './BeatCurve';
import { appendRamp, shiftBreakpoints, type Breakpoint } from './breakpoints';
import { buildSegmentBreakpoints, spreadForMode, type CarrierBreakpoints } from './carrierSchedule';
import { PAD_GLIDE_SEC } from './layers/pad';
import { carrierGain } from './loudness';
import { seedFromString } from './prng';
import type { SessionTimeline } from './SessionScheduler';
import { SEGMENT_CROSSFADE_SEC, type AmbienceId, type BeatMode } from './types';

export interface TimelinePlan {
  /**
   * セッション全体のモード。BinauralPair は一度しか作られないため、
   * 先頭セグメントのモードがセッション全体に適用される（リアルタイムも同じ挙動）。
   */
  mode: BeatMode;
  /** AM 深度。モードと同じくセッション単位（先頭セグメント） */
  amDepth: number;
  /** 搬送波の基準レベル（dBFS）。先頭セグメント */
  gainDb: number;
  /** 絶対時間の搬送波周波数 */
  carrier: CarrierBreakpoints;
  /** 搬送波の最終ゲイン（等ラウドネス補正込み・線形） */
  carrierGain: Breakpoint[];
  /** レイヤー ID → レベル（0–1） */
  layers: Map<AmbienceId, Breakpoint[]>;
  /** レイヤー ID → 生成に使うシード */
  layerSeeds: Map<AmbienceId, number>;
  /** リバーブ送り量（0–1） */
  reverb: Breakpoint[];
  /** セッションフェード（0–1） */
  fade: Breakpoint[];
  /** チャイムを鳴らす絶対時刻 */
  chimes: number[];
  /** パッドなどが参照する搬送波の切り替え点 */
  tonalCenters: Array<{ t: number; carrierHz: number }>;
  totalSec: number;
}

export function buildTimelinePlan(timeline: SessionTimeline): TimelinePlan {
  const entries = timeline.entries;
  const first = entries[0];
  if (!first) {
    return {
      mode: 'binaural',
      amDepth: 0,
      gainDb: -30,
      carrier: { left: [], right: [], am: [] },
      carrierGain: [],
      layers: new Map(),
      layerSeeds: new Map(),
      reverb: [],
      fade: [],
      chimes: [],
      tonalCenters: [],
      totalSec: 0,
    };
  }

  const mode = first.segment.beat.mode;
  const spread = spreadForMode(mode);

  const carrier: CarrierBreakpoints = { left: [], right: [], am: [] };
  const carrierGainPoints: Breakpoint[] = [];
  const reverb: Breakpoint[] = [];
  const fade: Breakpoint[] = [];
  const chimes: number[] = [];
  const tonalCenters: Array<{ t: number; carrierHz: number }> = [];

  // セッション中に一度でも登場するレイヤーをすべて拾う
  const layerIds = new Set<AmbienceId>();
  for (const entry of entries) {
    for (const id of Object.keys(entry.segment.ambience.layers) as AmbienceId[]) {
      if ((entry.segment.ambience.layers[id] ?? 0) > 0) layerIds.add(id);
    }
  }

  const layers = new Map<AmbienceId, Breakpoint[]>();
  const layerSeeds = new Map<AmbienceId, number>();
  for (const id of layerIds) {
    layers.set(id, []);
    layerSeeds.set(id, (first.segment.ambience.seed + seedFromString(id)) >>> 0);
  }

  let lastBeatHz: number | null = null;
  let lastCarrierHz = first.segment.beat.carrierHz;

  entries.forEach((entry, index) => {
    const { segment } = entry;
    const at = entry.startSec;
    const isFirst = index === 0;
    const isLast = index === entries.length - 1;
    const crossfadeSec = isFirst ? 0 : SEGMENT_CROSSFADE_SEC;

    // Δf カーブ（境界では直前の値から橋渡しして跳躍を防ぐ）
    const bridged =
      lastBeatHz === null
        ? segment.beat.curve
        : bridgeCurve(lastBeatHz, segment.beat.curve, SEGMENT_CROSSFADE_SEC);

    const segmentBreakpoints = buildSegmentBreakpoints({
      curve: bridged,
      fromCarrierHz: lastCarrierHz,
      toCarrierHz: segment.beat.carrierHz,
      carrierGlideSec: crossfadeSec,
      spread,
    });

    carrier.left.push(...shiftBreakpoints(segmentBreakpoints.left, at));
    carrier.right.push(...shiftBreakpoints(segmentBreakpoints.right, at));
    carrier.am.push(...shiftBreakpoints(segmentBreakpoints.am, at));

    // 搬送波ゲイン（等ラウドネス補正）。搬送波が変わるときだけグライドで追随する
    const gainTarget = carrierGain(segment.beat.gainDb, segment.beat.carrierHz);
    if (isFirst) {
      carrierGainPoints.push({ t: 0, value: gainTarget });
    } else if (segment.beat.carrierHz !== lastCarrierHz) {
      appendRamp(carrierGainPoints, at, crossfadeSec, gainTarget);
    }

    // 環境音のレベル（ミックスに無いレイヤーは 0 へ）
    for (const [id, points] of layers) {
      const level = segment.ambience.layers[id] ?? 0;
      if (isFirst) {
        points.push({ t: 0, value: level });
      } else {
        appendRamp(points, at, crossfadeSec, level);
      }
    }

    if (isFirst) {
      reverb.push({ t: 0, value: segment.ambience.reverb });
    } else {
      appendRamp(reverb, at, crossfadeSec, segment.ambience.reverb);
    }

    tonalCenters.push({ t: at, carrierHz: segment.beat.carrierHz });

    if (segment.chimeAtEnd) chimes.push(entry.endSec);

    // フェード
    if (isFirst) {
      fade.push({ t: 0, value: 0 });
      fade.push({ t: segment.fadeInSec, value: 1 });
    }
    if (isLast) {
      const fadeOutStart = entry.endSec - segment.fadeOutSec;
      fade.push({ t: fadeOutStart, value: 1 });
      fade.push({ t: entry.endSec, value: 0 });
    }

    lastBeatHz = beatHzAt(bridged, curveDurationSec(bridged));
    lastCarrierHz = segment.beat.carrierHz;
  });

  return {
    mode,
    amDepth: first.segment.beat.amDepth,
    gainDb: first.segment.beat.gainDb,
    carrier,
    carrierGain: carrierGainPoints,
    layers,
    layerSeeds,
    reverb,
    fade,
    chimes,
    tonalCenters,
    totalSec: timeline.totalSec,
  };
}

/** ある絶対時刻で有効な音高中心（パッドの追随用） */
export function tonalCenterAt(plan: TimelinePlan, t: number): number {
  let current = plan.tonalCenters[0]?.carrierHz ?? 240;
  for (const point of plan.tonalCenters) {
    if (point.t > t) break;
    current = point.carrierHz;
  }
  return current;
}

/**
 * 音高中心の推移をブレークポイント列にする。
 * パッドの累積位相を求めるために使う（PadLayer と同じ 1.5 秒のグライドを再現する）。
 */
export function tonalCenterBreakpoints(plan: TimelinePlan): Breakpoint[] {
  const points: Breakpoint[] = [];
  plan.tonalCenters.forEach((tc, index) => {
    if (index === 0) {
      points.push({ t: 0, value: tc.carrierHz });
    } else if (points[points.length - 1]!.value !== tc.carrierHz) {
      appendRamp(points, tc.t, PAD_GLIDE_SEC, tc.carrierHz);
    }
  });
  return points;
}
