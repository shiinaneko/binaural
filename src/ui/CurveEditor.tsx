/**
 * Δf カーブのドラッグ編集（SPEC.md §7.1-3）。
 *
 * 変化速度の上限を超えた区間を赤く示す。急な変化は不快なので、
 * 数値で見せるより「そこが速すぎる」と目で分かるほうがいい。
 */

import { useRef, useState } from 'react';
import { beatHzAt, maxRateHzPerMin } from '../audio/BeatCurve';
import type { BeatCurve } from '../audio/types';
import { BEAT_MAX_HZ, BEAT_MIN_HZ } from '../audio/types';
import { useT } from './useT';

const WIDTH = 600;
const HEIGHT = 220;
const PAD = { left: 34, right: 12, top: 12, bottom: 24 };

interface CurveEditorProps {
  curve: BeatCurve;
  durationSec: number;
  /** Hz/分の上限。超えた区間を警告表示する */
  maxRateHzPerMin: number;
  onChange(curve: BeatCurve): void;
}

export function CurveEditor({
  curve,
  durationSec,
  maxRateHzPerMin: rateLimit,
  onChange,
}: CurveEditorProps) {
  const t = useT();
  const svgRef = useRef<SVGSVGElement>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const maxHz = Math.max(20, ...curve.points.map((p) => p.hz)) + 2;
  const plotW = WIDTH - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;

  const toX = (t: number) => PAD.left + (t / durationSec) * plotW;
  const toY = (hz: number) => PAD.top + plotH - (hz / maxHz) * plotH;
  const fromX = (x: number) => ((x - PAD.left) / plotW) * durationSec;
  const fromY = (y: number) => ((PAD.top + plotH - y) / plotH) * maxHz;

  /** 表示用に密にサンプリングした線（smooth 補間を目で見えるようにする） */
  const path = (() => {
    const steps = 200;
    const parts: string[] = [];
    for (let i = 0; i <= steps; i++) {
      const t = (durationSec * i) / steps;
      parts.push(`${i === 0 ? 'M' : 'L'} ${toX(t).toFixed(2)} ${toY(beatHzAt(curve, t)).toFixed(2)}`);
    }
    return parts.join(' ');
  })();

  const pointerToValue = (event: React.PointerEvent): { t: number; hz: number } | null => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * WIDTH;
    const y = ((event.clientY - rect.top) / rect.height) * HEIGHT;
    return {
      t: Math.min(Math.max(fromX(x), 0), durationSec),
      hz: Math.min(Math.max(fromY(y), BEAT_MIN_HZ), Math.min(BEAT_MAX_HZ, maxHz)),
    };
  };

  const handleMove = (event: React.PointerEvent) => {
    if (dragIndex === null) return;
    const value = pointerToValue(event);
    if (!value) return;

    const points = curve.points.map((p) => ({ ...p }));
    const previous = points[dragIndex - 1];
    const next = points[dragIndex + 1];
    const isEdge = dragIndex === 0 || dragIndex === points.length - 1;

    points[dragIndex] = {
      // 両端は時間を動かさない（0 とセグメント長に固定）
      t: isEdge
        ? points[dragIndex]!.t
        : Math.min(Math.max(value.t, (previous?.t ?? 0) + 1), (next?.t ?? durationSec) - 1),
      hz: Math.round(value.hz * 10) / 10,
    };
    onChange({ ...curve, points });
  };

  const addPoint = (event: React.PointerEvent) => {
    const value = pointerToValue(event);
    if (!value) return;
    if (value.t <= 0 || value.t >= durationSec) return;
    const points = [...curve.points.map((p) => ({ ...p })), { t: value.t, hz: Math.round(value.hz * 10) / 10 }];
    points.sort((a, b) => a.t - b.t);
    onChange({ ...curve, points });
  };

  const removePoint = (index: number) => {
    if (curve.points.length <= 2) return;
    if (index === 0 || index === curve.points.length - 1) return;
    onChange({ ...curve, points: curve.points.filter((_, i) => i !== index) });
  };

  const rate = maxRateHzPerMin(curve);
  const tooFast = rate > rateLimit + 1e-6;

  /** 上限を超えている区間 */
  const fastSegments = curve.points.slice(1).flatMap((point, i) => {
    const previous = curve.points[i]!;
    const dt = point.t - previous.t;
    if (dt <= 0) return [];
    const segmentRate = (Math.abs(point.hz - previous.hz) / dt) * 60;
    return segmentRate > rateLimit + 1e-6 ? [{ from: previous, to: point }] : [];
  });

  return (
    <div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="curve-editor"
        onPointerMove={handleMove}
        onPointerUp={() => setDragIndex(null)}
        onPointerLeave={() => setDragIndex(null)}
        role="img"
        aria-label={t('curve.aria')}
      >
        {/* 目盛り */}
        {[0, 5, 10, 15, 20].filter((hz) => hz <= maxHz).map((hz) => (
          <g key={hz}>
            <line
              x1={PAD.left}
              x2={WIDTH - PAD.right}
              y1={toY(hz)}
              y2={toY(hz)}
              className="curve-grid"
            />
            <text x={4} y={toY(hz) + 4} className="curve-label">
              {hz}
            </text>
          </g>
        ))}
        {[0, 0.25, 0.5, 0.75, 1].map((fraction) => (
          <text
            key={fraction}
            x={toX(durationSec * fraction)}
            y={HEIGHT - 6}
            className="curve-label"
            textAnchor="middle"
          >
            {t('curve.minutesAxis', { n: Math.round((durationSec * fraction) / 60) })}
          </text>
        ))}

        {/* 上限超過の区間 */}
        {fastSegments.map((segment, i) => (
          <line
            key={i}
            x1={toX(segment.from.t)}
            y1={toY(segment.from.hz)}
            x2={toX(segment.to.t)}
            y2={toY(segment.to.hz)}
            className="curve-warning"
          />
        ))}

        {/* 背景（クリックで点を追加） */}
        <rect
          x={PAD.left}
          y={PAD.top}
          width={plotW}
          height={plotH}
          fill="transparent"
          onPointerDown={addPoint}
        />

        <path d={path} className="curve-line" />

        {curve.points.map((point, index) => (
          <circle
            key={index}
            cx={toX(point.t)}
            cy={toY(point.hz)}
            r={7}
            className="curve-point"
            onPointerDown={(e) => {
              e.stopPropagation();
              try {
                // 捕捉できない環境でもドラッグ自体は続けられるようにする
                (e.target as Element).setPointerCapture?.(e.pointerId);
              } catch {
                // NotFoundError 等。無視してよい
              }
              setDragIndex(index);
            }}
            onDoubleClick={() => removePoint(index)}
          />
        ))}
      </svg>

      <p className="faint" style={{ margin: '6px 0 0' }}>
        {t('curve.help')} {t('curve.rate', { rate: rate.toFixed(2) })}
        {tooFast ? (
          <strong style={{ color: 'var(--danger)' }}>
            {' '}
            {t('curve.tooFast', { limit: rateLimit })}
          </strong>
        ) : (
          <span className="faint"> / {t('curve.rateLimit', { limit: rateLimit })}</span>
        )}
      </p>
    </div>
  );
}
