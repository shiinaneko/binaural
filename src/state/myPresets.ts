/**
 * マイプリセットの保存（SPEC.md §8 / §10）。
 * localStorage のみ。JSON で書き出し・読み込みできる（手動での受け渡し用）。
 */

import { normalizeCurve } from '../audio/BeatCurve';
import { clampBeatHz, clampCarrierHz, minCarrierForBeat } from '../audio/carrier';
import type { AmbienceId, BeatMode, SessionPreset } from '../audio/types';
import { BEAT_MAX_HZ, BEAT_MIN_HZ } from '../audio/types';

const KEY = 'binaural-studio/my-presets/v1';
const MODES: BeatMode[] = ['binaural', 'monaural', 'isochronic', 'hybrid'];

export function loadMyPresets(): SessionPreset[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map(migrate).filter((p): p is SessionPreset => p !== null);
  } catch {
    return [];
  }
}

function persist(presets: SessionPreset[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(presets));
  } catch {
    // 容量超過やプライベートモード。保存できなくても再生は続けられる
  }
}

export function saveMyPreset(preset: SessionPreset): SessionPreset[] {
  const stored = loadMyPresets();
  const next = { ...preset, updatedAt: new Date().toISOString(), builtIn: false as const };
  const index = stored.findIndex((p) => p.id === preset.id);
  if (index >= 0) stored[index] = next;
  else stored.push(next);
  persist(stored);
  return stored;
}

export function deleteMyPreset(id: string): SessionPreset[] {
  const next = loadMyPresets().filter((p) => p.id !== id);
  persist(next);
  return next;
}

/** 組み込みプリセットを複製して編集用の下書きにする */
export function createDraftFrom(base: SessionPreset): SessionPreset {
  const now = new Date().toISOString();
  return {
    ...structuredClone(base),
    id: `my-${Date.now().toString(36)}`,
    // 名前は言語に依らない文字列にしておく（保存後に言語を変えても壊れないように）
    name: base.builtIn ? `${base.name} +` : base.name,
    category: 'custom',
    builtIn: false,
    createdAt: now,
    updatedAt: now,
  };
}

export function exportPresetJson(preset: SessionPreset): string {
  return JSON.stringify(preset, null, 2);
}

export class PresetImportError extends Error {}

export function importPresetJson(json: string): SessionPreset {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new PresetImportError('JSON として読めませんでした');
  }
  const preset = migrate(parsed);
  if (!preset) throw new PresetImportError('プリセットの形式が合いません');
  return { ...preset, id: `my-${Date.now().toString(36)}`, builtIn: false };
}

/**
 * 外部から来たデータを安全な形に整える。
 * schemaVersion で分岐できるようにしてあるが、今は v1 のみ。
 * 値のクランプはここで行い、再生側では前提が成り立っているものとして扱う。
 */
function migrate(raw: unknown): SessionPreset | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const source = raw as Record<string, unknown>;
  if (!Array.isArray(source.segments) || source.segments.length === 0) return null;

  const segments = source.segments
    .map((segment) => sanitizeSegment(segment))
    .filter((s): s is SessionPreset['segments'][number] => s !== null);
  if (segments.length === 0) return null;

  const now = new Date().toISOString();
  return {
    id: typeof source.id === 'string' ? source.id : `my-${Date.now().toString(36)}`,
    name: typeof source.name === 'string' ? source.name.slice(0, 60) : 'マイプリセット',
    category: 'custom',
    description: typeof source.description === 'string' ? source.description.slice(0, 200) : '',
    colorway: typeof source.colorway === 'string' ? source.colorway : 'indigo',
    segments,
    ...(typeof source.cycles === 'number'
      ? { cycles: Math.min(Math.max(Math.round(source.cycles), 2), 8) }
      : {}),
    createdAt: typeof source.createdAt === 'string' ? source.createdAt : now,
    updatedAt: now,
    builtIn: false,
    schemaVersion: 1,
  };
}

function sanitizeSegment(raw: unknown): SessionPreset['segments'][number] | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const source = raw as Record<string, unknown>;
  const beat = source.beat as Record<string, unknown> | undefined;
  if (!beat || typeof beat !== 'object') return null;

  const durationSec = Math.min(Math.max(Number(source.durationSec) || 1500, 60), 7200);

  const rawPoints = (beat.curve as { points?: unknown })?.points;
  const points = Array.isArray(rawPoints)
    ? rawPoints
        .map((p) => p as Record<string, unknown>)
        .filter((p) => Number.isFinite(Number(p.t)) && Number.isFinite(Number(p.hz)))
        .map((p) => ({
          t: Math.min(Math.max(Number(p.t), 0), durationSec),
          hz: clampBeatHz(Number(p.hz)),
        }))
    : [];
  if (points.length === 0) points.push({ t: 0, hz: 10 });

  const curve = normalizeCurve({
    points,
    interpolation:
      (beat.curve as { interpolation?: unknown })?.interpolation === 'linear' ? 'linear' : 'smooth',
  });
  // 末尾がセグメント長に届いていなければ伸ばす（再生側はこの前提で動く）
  const last = curve.points[curve.points.length - 1]!;
  if (last.t < durationSec) curve.points.push({ t: durationSec, hz: last.hz });

  const maxBeatHz = curve.points.reduce((max, p) => Math.max(max, p.hz), BEAT_MIN_HZ);
  const carrierHz = Math.max(
    clampCarrierHz(Number(beat.carrierHz) || 240),
    minCarrierForBeat(Math.min(maxBeatHz, BEAT_MAX_HZ)),
  );

  const layersRaw = (source.ambience as { layers?: unknown })?.layers;
  const layers: Partial<Record<AmbienceId, number>> = {};
  if (typeof layersRaw === 'object' && layersRaw !== null) {
    for (const [id, level] of Object.entries(layersRaw)) {
      const value = Number(level);
      if (Number.isFinite(value) && value > 0) {
        layers[id as AmbienceId] = Math.min(value, 1);
      }
    }
  }

  const mode = MODES.includes(beat.mode as BeatMode) ? (beat.mode as BeatMode) : 'binaural';
  const fadeInSec = Math.min(Math.max(Number(source.fadeInSec) || 6, 0), durationSec / 3);
  const fadeOutSec = Math.min(Math.max(Number(source.fadeOutSec) || 8, 0), durationSec / 3);

  return {
    kind: source.kind === 'shortBreak' || source.kind === 'longBreak' ? source.kind : 'focus',
    durationSec,
    beat: {
      mode,
      carrierHz,
      amDepth: Math.min(Math.max(Number(beat.amDepth) || 0, 0), 1),
      curve,
      gainDb: Math.min(Math.max(Number(beat.gainDb) || -30, -60), -12),
    },
    ambience: {
      layers,
      reverb: Math.min(Math.max(Number((source.ambience as { reverb?: unknown })?.reverb) || 0, 0), 1),
      seed: Number((source.ambience as { seed?: unknown })?.seed) || 1234,
    },
    fadeInSec,
    fadeOutSec,
    chimeAtEnd: source.chimeAtEnd !== false,
  };
}
