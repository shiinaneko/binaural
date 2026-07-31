/**
 * プリセットが仕様上の制約を守っているかの検証。
 * 音を聴かなくても崩れを検知できるようにしておく（SPEC.md §13）。
 */

import { describe, expect, it } from 'vitest';
import { beatHzAt, curveDurationSec, maxRateHzPerMin } from '../src/audio/BeatCurve';
import { isValidPair } from '../src/audio/carrier';
import { resolveAmbienceMix } from '../src/audio/layers/fallback';
import { buildTimeline } from '../src/audio/SessionScheduler';
import { MAX_RATE_HZ_PER_MIN } from '../src/audio/types';
import { BUILT_IN_PRESETS, DEFAULT_PRESET_ID, findPreset, toPomodoro } from '../src/presets/sessions';

const EPS = 1e-6;

describe('組み込みプリセット', () => {
  it('ID が一意', () => {
    const ids = BUILT_IN_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('既定プリセットが存在する', () => {
    expect(findPreset(DEFAULT_PRESET_ID)).toBeDefined();
  });

  it('カーブの長さがセグメントの長さと一致する', () => {
    for (const preset of BUILT_IN_PRESETS) {
      for (const segment of preset.segments) {
        expect(curveDurationSec(segment.beat.curve), preset.id).toBe(segment.durationSec);
      }
    }
  });

  it('Δf の変化速度が上限内（集中 2.0 / 瞑想 0.5 Hz/分）', () => {
    for (const preset of BUILT_IN_PRESETS) {
      const limit =
        preset.category === 'meditate' ? MAX_RATE_HZ_PER_MIN.meditate : MAX_RATE_HZ_PER_MIN.focus;
      for (const segment of preset.segments) {
        expect(maxRateHzPerMin(segment.beat.curve), preset.id).toBeLessThanOrEqual(limit + EPS);
      }
    }
  });

  it('搬送波と Δf の組み合わせが全時刻で有効', () => {
    for (const preset of BUILT_IN_PRESETS) {
      for (const segment of preset.segments) {
        const duration = segment.durationSec;
        for (let t = 0; t <= duration; t += 10) {
          const hz = beatHzAt(segment.beat.curve, t);
          expect(isValidPair(segment.beat.carrierHz, hz), `${preset.id} @${t}s Δf=${hz}`).toBe(true);
        }
      }
    }
  });

  it('フェードがセグメント長を超えない', () => {
    for (const preset of BUILT_IN_PRESETS) {
      for (const segment of preset.segments) {
        expect(segment.fadeInSec + segment.fadeOutSec, preset.id).toBeLessThan(segment.durationSec);
      }
    }
  });

  it('アイソクロニック以外は AM 深度 0（純バイノーラルを汚さない）', () => {
    for (const preset of BUILT_IN_PRESETS) {
      for (const segment of preset.segments) {
        if (segment.beat.mode === 'binaural') {
          expect(segment.beat.amDepth, preset.id).toBe(0);
        }
      }
    }
  });

  it('環境音レベルが 0–1 の範囲', () => {
    for (const preset of BUILT_IN_PRESETS) {
      for (const segment of preset.segments) {
        for (const level of Object.values(segment.ambience.layers)) {
          expect(level).toBeGreaterThan(0);
          expect(level).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('未実装レイヤーはすべて代替に解決できる（無音になるプリセットがない）', () => {
    for (const preset of BUILT_IN_PRESETS) {
      for (const segment of preset.segments) {
        const requested = Object.keys(segment.ambience.layers).length;
        if (requested === 0) continue;
        const resolved = resolveAmbienceMix(segment.ambience);
        expect(Object.keys(resolved.mix.layers).length, preset.id).toBeGreaterThan(0);
      }
    }
  });
});

describe('buildTimeline', () => {
  it('単発プリセットはセグメントをそのまま並べる', () => {
    const preset = findPreset('deep-work')!;
    const timeline = buildTimeline(preset);
    expect(timeline.entries).toHaveLength(1);
    expect(timeline.totalSec).toBe(25 * 60);
  });

  it('連続する startSec / endSec に隙間がない', () => {
    const timeline = buildTimeline(toPomodoro(findPreset('deep-work')!, { cycles: 4 }));
    for (let i = 1; i < timeline.entries.length; i++) {
      expect(timeline.entries[i]!.startSec).toBe(timeline.entries[i - 1]!.endSec);
    }
    expect(timeline.entries[0]!.startSec).toBe(0);
    expect(timeline.entries[timeline.entries.length - 1]!.endSec).toBe(timeline.totalSec);
  });

  it('ポモドーロは 集中×N + 小休憩×(N−1) + 長休憩 に展開される', () => {
    const timeline = buildTimeline(toPomodoro(findPreset('deep-work')!, { cycles: 4 }));
    const kinds = timeline.entries.map((e) => e.segment.kind);
    expect(kinds.filter((k) => k === 'focus')).toHaveLength(4);
    expect(kinds.filter((k) => k === 'shortBreak')).toHaveLength(3);
    expect(kinds.filter((k) => k === 'longBreak')).toHaveLength(1);
    expect(kinds[kinds.length - 1]).toBe('longBreak');
    // 25*4 + 5*3 + 20 = 135 分
    expect(timeline.totalSec).toBe(135 * 60);
  });

  it('サイクル数を変えても構造が保たれる', () => {
    for (const cycles of [2, 3, 6, 8]) {
      const timeline = buildTimeline(toPomodoro(findPreset('flow')!, { cycles }));
      const kinds = timeline.entries.map((e) => e.segment.kind);
      expect(kinds.filter((k) => k === 'focus')).toHaveLength(cycles);
      expect(kinds.filter((k) => k === 'shortBreak')).toHaveLength(cycles - 1);
    }
  });

  it('ポモドーロの休憩もカーブ長と制約を満たす', () => {
    const pomodoro = toPomodoro(findPreset('deep-work')!, { cycles: 4 });
    for (const segment of pomodoro.segments) {
      expect(curveDurationSec(segment.beat.curve)).toBe(segment.durationSec);
      expect(isValidPair(segment.beat.carrierHz, beatHzAt(segment.beat.curve, 0))).toBe(true);
    }
  });
});
