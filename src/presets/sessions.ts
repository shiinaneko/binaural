/**
 * 組み込みセッションプリセット（SPEC.md §4.3）。
 *
 * 既定の入口は「単発 25 分」。ポモドーロのサイクルは toPomodoro() で展開する。
 */

import { constantCurve, rampCurve } from '../audio/BeatCurve';
import { seedFromString } from '../audio/prng';
import {
  DEFAULT_CARRIER_GAIN_DB,
  DEFAULT_FADE_IN_SEC,
  DEFAULT_FADE_OUT_SEC,
  type AmbienceId,
  type AmbienceMix,
  type BeatConfig,
  type BeatCurve,
  type Segment,
  type SessionPreset,
} from '../audio/types';

const BUILT_AT = '2026-07-30T00:00:00.000Z';

function mix(seedKey: string, layers: Partial<Record<AmbienceId, number>>, reverb = 0.2): AmbienceMix {
  return { layers, reverb, seed: seedFromString(seedKey) };
}

function beat(opts: {
  curve: BeatCurve;
  carrierHz: number;
  mode?: BeatConfig['mode'];
  amDepth?: number;
  gainDb?: number;
}): BeatConfig {
  return {
    mode: opts.mode ?? 'binaural',
    carrierHz: opts.carrierHz,
    amDepth: opts.amDepth ?? 0,
    curve: opts.curve,
    gainDb: opts.gainDb ?? DEFAULT_CARRIER_GAIN_DB,
  };
}

function segment(opts: {
  kind?: Segment['kind'];
  durationSec: number;
  beat: BeatConfig;
  ambience: AmbienceMix;
  fadeInSec?: number;
  fadeOutSec?: number;
  chimeAtEnd?: boolean;
}): Segment {
  return {
    kind: opts.kind ?? 'focus',
    durationSec: opts.durationSec,
    beat: opts.beat,
    ambience: opts.ambience,
    fadeInSec: opts.fadeInSec ?? DEFAULT_FADE_IN_SEC,
    fadeOutSec: opts.fadeOutSec ?? DEFAULT_FADE_OUT_SEC,
    chimeAtEnd: opts.chimeAtEnd ?? true,
  };
}

function preset(p: Omit<SessionPreset, 'createdAt' | 'updatedAt' | 'builtIn' | 'schemaVersion'>): SessionPreset {
  return { ...p, createdAt: BUILT_AT, updatedAt: BUILT_AT, builtIn: true, schemaVersion: 1 };
}

const MIN = 60;

// ---------------------------------------------------------------------------
// 集中系
// ---------------------------------------------------------------------------

const deepWork = preset({
  id: 'deep-work',
  name: 'Deep Work',
  category: 'focus',
  description: 'α10 Hz から 3 分で β16 Hz へ。終盤は 12 Hz に落として切り上げを促す',
  colorway: 'indigo',
  segments: [
    segment({
      durationSec: 25 * MIN,
      beat: beat({
        carrierHz: 320,
        curve: rampCurve({
          fromHz: 10,
          toHz: 16,
          durationSec: 25 * MIN,
          onsetSec: 3 * MIN,
          taperSec: 3 * MIN,
          endHz: 12,
        }),
      }),
      ambience: mix('deep-work', { brown: 0.6 }),
    }),
  ],
});

const flow = preset({
  id: 'flow',
  name: 'Flow',
  category: 'focus',
  description: 'SMR 14 Hz 固定と雨音。変化がないので作業に沈みやすい',
  colorway: 'teal',
  segments: [
    segment({
      durationSec: 25 * MIN,
      beat: beat({ carrierHz: 280, curve: constantCurve(14, 25 * MIN) }),
      ambience: mix('flow', { rain: 0.7 }, 0.25),
    }),
  ],
});

const reading = preset({
  id: 'reading',
  name: 'Reading',
  category: 'focus',
  description: 'α10.5 Hz。読書や資料読みのための、静かで主張しない音',
  colorway: 'sand',
  segments: [
    segment({
      durationSec: 25 * MIN,
      beat: beat({ carrierHz: 240, curve: constantCurve(10.5, 25 * MIN) }),
      ambience: mix('reading', { air: 0.4, pad: 0.25 }, 0.3),
    }),
  ],
});

const creative = preset({
  id: 'creative',
  name: 'Creative',
  category: 'focus',
  description: 'θ6.5 と α9 の間を 8 分周期でゆるく往復する。発散的な作業向け',
  colorway: 'violet',
  segments: [
    segment({
      durationSec: 25 * MIN,
      beat: beat({
        carrierHz: 220,
        curve: {
          points: [
            { t: 0, hz: 9 },
            { t: 4 * MIN, hz: 6.5 },
            { t: 8 * MIN, hz: 9 },
            { t: 12 * MIN, hz: 6.5 },
            { t: 16 * MIN, hz: 9 },
            { t: 20 * MIN, hz: 6.5 },
            { t: 25 * MIN, hz: 9 },
          ],
          interpolation: 'smooth',
        },
      }),
      ambience: mix('creative', { pad: 0.55, forest: 0.3 }, 0.4),
    }),
  ],
});

const gammaSprint = preset({
  id: 'gamma-sprint',
  name: 'Gamma Sprint',
  category: 'focus',
  description: '40 Hz のアイソクロニック（純バイノーラルでは知覚が弱い帯域）。15 分の短距離走',
  colorway: 'amber',
  segments: [
    segment({
      durationSec: 15 * MIN,
      beat: beat({
        carrierHz: 400,
        mode: 'isochronic',
        amDepth: 0.85,
        curve: constantCurve(40, 15 * MIN),
      }),
      ambience: mix('gamma-sprint', { brown: 0.45 }),
    }),
  ],
});

// ---------------------------------------------------------------------------
// 瞑想 / リラックス系
// ---------------------------------------------------------------------------

const unwind = preset({
  id: 'unwind',
  name: 'Unwind',
  category: 'meditate',
  description: '仕事のあとに。α10 Hz から 10 分かけて θ6 Hz へ沈む',
  colorway: 'ocean',
  segments: [
    segment({
      durationSec: 25 * MIN,
      beat: beat({
        carrierHz: 200,
        curve: rampCurve({ fromHz: 10, toHz: 6, durationSec: 25 * MIN, onsetSec: 10 * MIN }),
      }),
      ambience: mix('unwind', { ocean: 0.7 }, 0.35),
    }),
  ],
});

const deepMeditation = preset({
  id: 'deep-meditation',
  name: 'Deep Meditation',
  category: 'meditate',
  description: 'θ5.5 → 4.5 Hz へごく緩やかに。シンギングボウルとドローン',
  colorway: 'midnight',
  segments: [
    segment({
      durationSec: 25 * MIN,
      beat: beat({
        carrierHz: 200,
        curve: rampCurve({ fromHz: 5.5, toHz: 4.5, durationSec: 25 * MIN, onsetSec: 15 * MIN }),
      }),
      ambience: mix('deep-meditation', { bowl: 0.5, drone: 0.3 }, 0.5),
    }),
  ],
});

const bodyScan = preset({
  id: 'body-scan',
  name: 'Body Scan',
  category: 'meditate',
  description: 'θ7 Hz 固定と焚き火。20 分のボディスキャン瞑想に',
  colorway: 'ember',
  segments: [
    segment({
      durationSec: 20 * MIN,
      beat: beat({ carrierHz: 200, curve: constantCurve(7, 20 * MIN) }),
      ambience: mix('body-scan', { fire: 0.65 }, 0.3),
    }),
  ],
});

const schumann = preset({
  id: 'schumann',
  name: 'Schumann 7.83',
  category: 'meditate',
  description: 'シューマン共振と同じ 7.83 Hz。森と小川の音と',
  colorway: 'forest',
  segments: [
    segment({
      durationSec: 25 * MIN,
      beat: beat({ carrierHz: 200, curve: constantCurve(7.83, 25 * MIN) }),
      ambience: mix('schumann', { forest: 0.6 }, 0.3),
    }),
  ],
});

const preSleep = preset({
  id: 'pre-sleep',
  name: 'Pre-Sleep',
  category: 'meditate',
  description: 'θ6 → δ2.5 Hz。最後の 5 分はそのまま無音へ消えていく',
  colorway: 'night',
  segments: [
    segment({
      durationSec: 25 * MIN,
      beat: beat({
        carrierHz: 160,
        curve: rampCurve({ fromHz: 6, toHz: 2.5, durationSec: 25 * MIN, onsetSec: 15 * MIN }),
      }),
      ambience: mix('pre-sleep', { drone: 0.5, rain: 0.3 }, 0.4),
      fadeOutSec: 5 * MIN,
      chimeAtEnd: false,
    }),
  ],
});

export const BUILT_IN_PRESETS: SessionPreset[] = [
  deepWork,
  flow,
  reading,
  creative,
  gammaSprint,
  unwind,
  deepMeditation,
  bodyScan,
  schumann,
  preSleep,
];

export const DEFAULT_PRESET_ID = 'deep-work';

export function findPreset(id: string): SessionPreset | undefined {
  return BUILT_IN_PRESETS.find((p) => p.id === id);
}

// ---------------------------------------------------------------------------
// ポモドーロ展開
// ---------------------------------------------------------------------------

export interface PomodoroOptions {
  cycles?: number;
  shortBreakSec?: number;
  longBreakSec?: number;
}

/**
 * 集中プリセットを休憩付きのサイクルへ展開する（SPEC.md §4.1）。
 * 休憩は集中セグメントの雰囲気を薄めて引き継ぎ、ビートだけを穏やかな帯域に置き換える。
 */
export function toPomodoro(source: SessionPreset, opts: PomodoroOptions = {}): SessionPreset {
  const cycles = opts.cycles ?? 4;
  const shortBreakSec = opts.shortBreakSec ?? 5 * MIN;
  const longBreakSec = opts.longBreakSec ?? 20 * MIN;

  const focus = source.segments[0];
  if (!focus) return source;

  const softened = (scale: number): AmbienceMix => ({
    ...focus.ambience,
    layers: Object.fromEntries(
      Object.entries(focus.ambience.layers).map(([id, level]) => [id, (level ?? 0) * scale]),
    ),
  });

  const shortBreak = segment({
    kind: 'shortBreak',
    durationSec: shortBreakSec,
    beat: beat({ carrierHz: 240, curve: constantCurve(10, shortBreakSec) }),
    ambience: softened(0.8),
  });

  const longBreak = segment({
    kind: 'longBreak',
    durationSec: longBreakSec,
    beat: beat({ carrierHz: 200, curve: constantCurve(6.5, longBreakSec) }),
    ambience: softened(0.7),
  });

  return {
    ...source,
    id: `${source.id}--pomodoro`,
    name: `${source.name}（ポモドーロ ${cycles} 本）`,
    segments: [focus, shortBreak, longBreak],
    cycles,
  };
}
