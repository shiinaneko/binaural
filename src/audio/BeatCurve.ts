/**
 * ビート周波数カーブ（SPEC.md §4.2）。
 *
 * セグメント内で Δf を時間変化させる。「導入 → 保持 → 収束」を点列で表し、
 * 再生時は AudioParam のランプ列に展開する。
 */

import type { BeatCurve, BeatCurvePoint } from './types';
import { BEAT_MIN_HZ, BEAT_MAX_HZ } from './types';

function clampHz(hz: number): number {
  return Math.min(Math.max(hz, BEAT_MIN_HZ), BEAT_MAX_HZ);
}

/**
 * 点列を正規化する。
 * - hz を有効範囲にクランプ
 * - t 昇順にソートし、同一 t は後の点を採用
 * - 先頭が t=0 でなければ同じ hz の点を t=0 に補う
 */
export function normalizeCurve(curve: BeatCurve): BeatCurve {
  const valid = curve.points.filter((p) => Number.isFinite(p.t) && Number.isFinite(p.hz) && p.t >= 0);
  if (valid.length === 0) {
    throw new Error('BeatCurve には少なくとも 1 点が必要です');
  }

  const sorted = [...valid].sort((a, b) => a.t - b.t);
  const deduped: BeatCurvePoint[] = [];
  for (const p of sorted) {
    const point = { t: p.t, hz: clampHz(p.hz) };
    const last = deduped[deduped.length - 1];
    if (last && last.t === point.t) {
      deduped[deduped.length - 1] = point; // 同一 t は後勝ち
    } else {
      deduped.push(point);
    }
  }

  const first = deduped[0]!;
  if (first.t !== 0) {
    deduped.unshift({ t: 0, hz: first.hz });
  }

  return { points: deduped, interpolation: curve.interpolation };
}

export function curveDurationSec(curve: BeatCurve): number {
  const last = curve.points[curve.points.length - 1];
  return last ? last.t : 0;
}

function smoothstep(u: number): number {
  return u * u * (3 - 2 * u);
}

/** 時刻 t（セグメント開始からの秒数）における Δf。範囲外は端の値で保持する。 */
export function beatHzAt(curve: BeatCurve, t: number): number {
  const pts = curve.points;
  const first = pts[0];
  if (!first) throw new Error('BeatCurve が空です');
  if (t <= first.t) return first.hz;

  const last = pts[pts.length - 1]!;
  if (t >= last.t) return last.hz;

  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    if (t <= b.t) {
      const span = b.t - a.t;
      if (span <= 0) return b.hz;
      const u = (t - a.t) / span;
      const w = curve.interpolation === 'smooth' ? smoothstep(u) : u;
      return a.hz + (b.hz - a.hz) * w;
    }
  }
  return last.hz;
}

/** カーブ中の最大変化速度（Hz/分）。UI の警告と検証に使う。 */
export function maxRateHzPerMin(curve: BeatCurve): number {
  let max = 0;
  for (let i = 1; i < curve.points.length; i++) {
    const a = curve.points[i - 1]!;
    const b = curve.points[i]!;
    const dt = b.t - a.t;
    if (dt <= 0) {
      if (b.hz !== a.hz) return Infinity; // 時間ゼロでの跳躍
      continue;
    }
    max = Math.max(max, (Math.abs(b.hz - a.hz) / dt) * 60);
  }
  return max;
}

/**
 * 変化速度が上限を超えないように点列を丸める（前方から順に、直前の点を基準にクランプ）。
 * 目標周波数に到達しなくなる場合があるため、UI 側では併せて警告を出す。
 */
export function clampCurveRate(curve: BeatCurve, maxHzPerMin: number): BeatCurve {
  const normalized = normalizeCurve(curve);
  const maxPerSec = maxHzPerMin / 60;
  const out: BeatCurvePoint[] = [normalized.points[0]!];

  for (let i = 1; i < normalized.points.length; i++) {
    const prev = out[out.length - 1]!;
    const p = normalized.points[i]!;
    const dt = p.t - prev.t;
    if (dt <= 0) {
      out.push({ t: p.t, hz: prev.hz });
      continue;
    }
    const maxDelta = maxPerSec * dt;
    const delta = Math.min(Math.max(p.hz - prev.hz, -maxDelta), maxDelta);
    out.push({ t: p.t, hz: clampHz(prev.hz + delta) });
  }

  return { points: out, interpolation: normalized.interpolation };
}

/** 1 つの遷移を分解する最大ステップ数。長い遷移で自動化イベントが増えすぎないように抑える。 */
const MAX_STEPS_PER_TRANSITION = 200;

/**
 * AudioParam に流し込むためのランプ列へ展開する。
 * linear はそのまま点列を返す。smooth は stepSec 刻みの微小ランプ列に分解する
 * （linearRampToValueAtTime の連鎖で滑らかな S 字を近似する）。
 */
export function toRampSteps(curve: BeatCurve, stepSec = 0.5): BeatCurvePoint[] {
  const normalized = normalizeCurve(curve);
  if (normalized.interpolation === 'linear') return normalized.points;

  const out: BeatCurvePoint[] = [normalized.points[0]!];
  for (let i = 1; i < normalized.points.length; i++) {
    const a = normalized.points[i - 1]!;
    const b = normalized.points[i]!;
    const span = b.t - a.t;
    if (span <= 0 || a.hz === b.hz) {
      out.push(b);
      continue;
    }
    const steps = Math.min(Math.max(1, Math.ceil(span / stepSec)), MAX_STEPS_PER_TRANSITION);
    for (let s = 1; s <= steps; s++) {
      const u = s / steps;
      out.push({ t: a.t + span * u, hz: a.hz + (b.hz - a.hz) * smoothstep(u) });
    }
  }
  return out;
}

/**
 * セグメント境界で Δf が跳ばないように、カーブの先頭に橋渡しを差し込む。
 * 先頭 bridgeSec を fromHz → 元のカーブの bridgeSec 時点の値へのランプに置き換える。
 * 音を止めずにセグメントを繋ぐ設計（SPEC.md §4.1）の一部。
 */
export function bridgeCurve(fromHz: number, curve: BeatCurve, bridgeSec: number): BeatCurve {
  const normalized = normalizeCurve(curve);
  if (bridgeSec <= 0) return normalized;

  const duration = curveDurationSec(normalized);
  const bridge = Math.min(bridgeSec, duration);
  if (bridge <= 0) return normalized;

  const rest = normalized.points.filter((p) => p.t > bridge);
  return normalizeCurve({
    points: [{ t: 0, hz: fromHz }, { t: bridge, hz: beatHzAt(normalized, bridge) }, ...rest],
    interpolation: normalized.interpolation,
  });
}

/** 一定 Δf のカーブを作る簡易ヘルパー */
export function constantCurve(hz: number, durationSec: number): BeatCurve {
  return {
    points: [
      { t: 0, hz },
      { t: durationSec, hz },
    ],
    interpolation: 'linear',
  };
}

/**
 * 「導入 → 保持 → 収束」の 3 相カーブを作る。
 * @param onsetSec  fromHz から toHz へ上昇（下降）する時間
 * @param taperSec  終端で endHz へ向かう時間（endHz 省略時は収束なし）
 */
export function rampCurve(opts: {
  fromHz: number;
  toHz: number;
  durationSec: number;
  onsetSec: number;
  taperSec?: number;
  endHz?: number;
  interpolation?: 'linear' | 'smooth';
}): BeatCurve {
  const { fromHz, toHz, durationSec, onsetSec } = opts;
  const points: BeatCurvePoint[] = [
    { t: 0, hz: fromHz },
    { t: Math.min(onsetSec, durationSec), hz: toHz },
  ];
  if (opts.taperSec && opts.endHz !== undefined && opts.taperSec < durationSec - onsetSec) {
    points.push({ t: durationSec - opts.taperSec, hz: toHz });
    points.push({ t: durationSec, hz: opts.endHz });
  } else {
    points.push({ t: durationSec, hz: toHz });
  }
  return normalizeCurve({ points, interpolation: opts.interpolation ?? 'smooth' });
}
