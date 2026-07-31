/**
 * 時間 → 値の区分線形な列（ブレークポイント）と、その操作。
 *
 * 周波数・ゲイン・レイヤーのレベル・フェード、すべてを同じ形で表す。
 * この形にしておくと 3 つのことが同じコードでできる:
 *
 * 1. AudioParam に流し込む（リアルタイム再生・オフライン描画）
 * 2. 任意時刻の値を求める（表示、検証）
 * 3. 窓に切り出す／積分する（分割レンダリングの位相計算）
 */

export interface Breakpoint {
  /** 起点からの秒数 */
  t: number;
  value: number;
}

/** 区分線形として補間した、任意時刻の値。列の外側は端の値で一定。 */
export function valueAt(points: Breakpoint[], t: number): number {
  if (points.length === 0) return 0;
  const first = points[0]!;
  if (t <= first.t) return first.value;
  const last = points[points.length - 1]!;
  if (t >= last.t) return last.value;

  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    if (t <= b.t) {
      const span = b.t - a.t;
      if (span <= 0) return b.value;
      return a.value + (b.value - a.value) * ((t - a.t) / span);
    }
  }
  return last.value;
}

/**
 * AudioParam に適用する。先頭は setValueAtTime、以降は linearRamp の連鎖。
 * @param offsetSec ブレークポイントの t に足す時刻（絶対時間への変換）
 */
export function applyBreakpoints(
  param: AudioParam,
  points: Breakpoint[],
  offsetSec: number,
): void {
  if (points.length === 0) return;
  const head = points[0]!;
  param.cancelScheduledValues(offsetSec + head.t);
  param.setValueAtTime(head.value, offsetSec + head.t);
  for (let i = 1; i < points.length; i++) {
    const p = points[i]!;
    param.linearRampToValueAtTime(p.value, offsetSec + p.t);
  }
}

/**
 * [fromSec, toSec] の窓に切り出す。
 * 窓の両端には補間した値の点を挿し、時刻は fromSec を 0 とした相対値に付け替える。
 * 分割レンダリングで「チャンクの途中から始まる自動化」を再現するために使う。
 */
export function clipBreakpoints(
  points: Breakpoint[],
  fromSec: number,
  toSec: number,
): Breakpoint[] {
  if (points.length === 0) return [];
  const out: Breakpoint[] = [{ t: 0, value: valueAt(points, fromSec) }];
  for (const p of points) {
    if (p.t <= fromSec) continue;
    if (p.t > toSec) break;
    out.push({ t: p.t - fromSec, value: p.value });
  }
  const endRelative = toSec - fromSec;
  const last = out[out.length - 1]!;
  if (last.t < endRelative) {
    out.push({ t: endRelative, value: valueAt(points, toSec) });
  }
  return out;
}

/**
 * [0, untilSec] の台形積分。
 * 列の外側は端の値で一定として扱う（setValueAtTime とランプ終了後の保持に対応）。
 */
export function integrate(points: Breakpoint[], untilSec: number): number {
  if (points.length === 0 || untilSec <= 0) return 0;

  let total = 0;
  const first = points[0]!;

  if (first.t > 0) {
    total += first.value * Math.min(first.t, untilSec);
    if (untilSec <= first.t) return total;
  }

  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    if (a.t >= untilSec) break;
    const span = b.t - a.t;
    if (span <= 0) continue;

    const end = Math.min(b.t, untilSec);
    const valueAtEnd = a.value + (b.value - a.value) * ((end - a.t) / span);
    total += ((a.value + valueAtEnd) / 2) * (end - a.t);
  }

  const last = points[points.length - 1]!;
  if (untilSec > last.t) {
    total += last.value * (untilSec - last.t);
  }

  return total;
}

/** 時刻をずらした新しい列を返す */
export function shiftBreakpoints(points: Breakpoint[], offsetSec: number): Breakpoint[] {
  return points.map((p) => ({ t: p.t + offsetSec, value: p.value }));
}

/**
 * 列に「ランプ」を追記する。直前の値を起点に、startSec から durationSec かけて value へ。
 * durationSec が 0 なら段差として置く。
 */
export function appendRamp(
  points: Breakpoint[],
  startSec: number,
  durationSec: number,
  value: number,
): void {
  const previous = points.length > 0 ? points[points.length - 1]!.value : value;
  points.push({ t: startSec, value: previous });
  points.push({ t: startSec + Math.max(durationSec, 0), value });
}
