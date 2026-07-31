/**
 * タイムラインプラン（書き出し用）と SessionScheduler（再生用）の一致検証。
 *
 * この 2 つは別々のコードでタイムラインを自動化に落としている。
 * 食い違うと「プレビューで聴いた音」と「書き出したファイル」が別物になり、
 * しかもそれは耳で気づきにくい。ここで機械的に突き合わせておく。
 */

import { describe, expect, it } from 'vitest';
import { AudioEngine } from '../src/audio/AudioEngine';
import { constantCurve, rampCurve } from '../src/audio/BeatCurve';
import { valueAt } from '../src/audio/breakpoints';
import { carrierGain } from '../src/audio/loudness';
import { buildTimeline, SessionScheduler } from '../src/audio/SessionScheduler';
import { buildTimelinePlan, tonalCenterBreakpoints } from '../src/audio/timelinePlan';
import { SEGMENT_CROSSFADE_SEC, type Segment, type SessionPreset } from '../src/audio/types';
import { createFakeContext, type FakeParam } from './fakeAudio';

const MIN = 60;

function segment(over: Partial<Segment> & Pick<Segment, 'durationSec' | 'beat'>): Segment {
  return {
    kind: 'focus',
    ambience: { layers: { brown: 0.6 }, reverb: 0.2, seed: 1234 },
    fadeInSec: 6,
    fadeOutSec: 8,
    chimeAtEnd: true,
    ...over,
  };
}

function preset(segments: Segment[], cycles?: number): SessionPreset {
  return {
    id: 'test',
    name: 'test',
    category: 'focus',
    description: '',
    colorway: 'indigo',
    segments,
    ...(cycles ? { cycles } : {}),
    createdAt: '',
    updatedAt: '',
    builtIn: false,
    schemaVersion: 1,
  };
}

const twoSegments = preset([
  segment({
    durationSec: 4 * MIN,
    beat: {
      mode: 'binaural',
      carrierHz: 320,
      amDepth: 0,
      gainDb: -30,
      curve: rampCurve({ fromHz: 10, toHz: 16, durationSec: 4 * MIN, onsetSec: 60 }),
    },
  }),
  segment({
    kind: 'shortBreak',
    durationSec: 3 * MIN,
    beat: {
      mode: 'binaural',
      carrierHz: 240,
      amDepth: 0,
      gainDb: -30,
      curve: constantCurve(10, 3 * MIN),
    },
    ambience: { layers: { brown: 0.4, pink: 0.2 }, reverb: 0.4, seed: 1234 },
  }),
]);

/** スケジューラを走らせて、オシレータに予約された周波数の (時刻, 値) を取り出す */
function scheduleAndCapture(source: SessionPreset) {
  const { ctx, oscillators } = createFakeContext();
  const engine = new AudioEngine(ctx);
  const timeline = buildTimeline(source);
  const scheduler = new SessionScheduler({ engine, timeline });
  const startDelay = 0.05;
  scheduler.start(startDelay);

  // BinauralPair は L → R → AM の順に作る
  const [oscL, oscR, oscAm] = oscillators;
  const toPoints = (param: FakeParam) =>
    param.events
      .filter((e) => e.type === 'set' || e.type === 'ramp')
      .map((e) => ({ t: +(e.time - startDelay).toFixed(9), value: e.value! }));

  return {
    left: toPoints(oscL!.frequency),
    right: toPoints(oscR!.frequency),
    am: toPoints(oscAm!.frequency),
    fade: engine.sessionFade.gain as unknown as FakeParam,
    startDelay,
  };
}

describe('buildTimelinePlan とスケジューラの一致', () => {
  it('左右と AM の周波数の予約が一致する', () => {
    const captured = scheduleAndCapture(twoSegments);
    const plan = buildTimelinePlan(buildTimeline(twoSegments));

    for (const channel of ['left', 'right', 'am'] as const) {
      const scheduled = captured[channel];
      const planned = plan.carrier[channel];
      expect(scheduled.length, channel).toBe(planned.length);
      for (let i = 0; i < scheduled.length; i++) {
        expect(scheduled[i]!.t, `${channel}[${i}].t`).toBeCloseTo(planned[i]!.t, 6);
        expect(scheduled[i]!.value, `${channel}[${i}].value`).toBeCloseTo(planned[i]!.value, 6);
      }
    }
  });

  it('任意の時刻でプランとスケジュール済みの値が一致する', () => {
    const captured = scheduleAndCapture(twoSegments);
    const plan = buildTimelinePlan(buildTimeline(twoSegments));
    for (let t = 0; t <= 7 * MIN; t += 3.7) {
      expect(valueAt(captured.left, t)).toBeCloseTo(valueAt(plan.carrier.left, t), 6);
      expect(valueAt(captured.right, t)).toBeCloseTo(valueAt(plan.carrier.right, t), 6);
    }
  });

  it('左右の差が全時刻で Δf に一致する', () => {
    const plan = buildTimelinePlan(buildTimeline(twoSegments));
    for (let t = 0; t <= 7 * MIN; t += 2.5) {
      const delta = valueAt(plan.carrier.right, t) - valueAt(plan.carrier.left, t);
      expect(delta).toBeCloseTo(valueAt(plan.carrier.am, t), 6);
    }
  });

  it('セッションフェードの予約が一致する', () => {
    const captured = scheduleAndCapture(twoSegments);
    const plan = buildTimelinePlan(buildTimeline(twoSegments));
    const scheduled = captured.fade.events
      .filter((e) => e.type === 'set' || e.type === 'ramp')
      .map((e) => ({ t: +(e.time - captured.startDelay).toFixed(9), value: e.value! }));

    for (const t of [0, 3, 6, 100, 7 * MIN - 8, 7 * MIN]) {
      expect(valueAt(scheduled, t), `t=${t}`).toBeCloseTo(valueAt(plan.fade, t), 6);
    }
  });
});

describe('buildTimelinePlan の中身', () => {
  const plan = buildTimelinePlan(buildTimeline(twoSegments));

  it('モードと AM 深度は先頭セグメントから決まる', () => {
    expect(plan.mode).toBe('binaural');
    expect(plan.amDepth).toBe(0);
    expect(plan.gainDb).toBe(-30);
  });

  it('搬送波ゲインが等ラウドネス補正と一致する', () => {
    expect(valueAt(plan.carrierGain, 0)).toBeCloseTo(carrierGain(-30, 320), 9);
    // 2 番目のセグメントの搬送波へ、クロスフェード時間で移る
    const at = 4 * MIN + SEGMENT_CROSSFADE_SEC;
    expect(valueAt(plan.carrierGain, at)).toBeCloseTo(carrierGain(-30, 240), 9);
  });

  it('セグメント境界で Δf が跳ばない（橋渡しが効いている）', () => {
    const boundary = 4 * MIN;
    const before = valueAt(plan.carrier.am, boundary - 0.01);
    const after = valueAt(plan.carrier.am, boundary + 0.01);
    expect(Math.abs(after - before)).toBeLessThan(0.05);
  });

  it('レイヤーは登場するものをすべて含み、境界でクロスフェードする', () => {
    expect([...plan.layers.keys()].sort()).toEqual(['brown', 'pink']);
    // pink は 2 番目のセグメントだけ。最初は 0
    expect(valueAt(plan.layers.get('pink')!, 0)).toBe(0);
    expect(valueAt(plan.layers.get('pink')!, 4 * MIN + SEGMENT_CROSSFADE_SEC)).toBeCloseTo(0.2, 9);
    // 境界の途中では中間値
    expect(valueAt(plan.layers.get('pink')!, 4 * MIN + SEGMENT_CROSSFADE_SEC / 2)).toBeCloseTo(
      0.1,
      9,
    );
  });

  it('リバーブも境界でクロスフェードする', () => {
    expect(valueAt(plan.reverb, 0)).toBeCloseTo(0.2, 9);
    expect(valueAt(plan.reverb, 4 * MIN + SEGMENT_CROSSFADE_SEC)).toBeCloseTo(0.4, 9);
  });

  it('フェードイン・アウトが両端に入る', () => {
    expect(valueAt(plan.fade, 0)).toBe(0);
    expect(valueAt(plan.fade, 6)).toBe(1);
    expect(valueAt(plan.fade, 7 * MIN - 8)).toBe(1);
    expect(valueAt(plan.fade, 7 * MIN)).toBe(0);
  });

  it('チャイムがセグメント末尾に入る', () => {
    expect(plan.chimes).toEqual([4 * MIN, 7 * MIN]);
  });

  it('音高中心がセグメントごとに切り替わる', () => {
    expect(plan.tonalCenters).toEqual([
      { t: 0, carrierHz: 320 },
      { t: 4 * MIN, carrierHz: 240 },
    ]);
  });

  it('音高中心のブレークポイントがグライドを持つ', () => {
    const points = tonalCenterBreakpoints(plan);
    expect(valueAt(points, 0)).toBe(320);
    expect(valueAt(points, 4 * MIN)).toBe(320);
    expect(valueAt(points, 4 * MIN + 1.5)).toBe(240);
    expect(valueAt(points, 4 * MIN + 0.75)).toBeCloseTo(280, 6);
  });

  it('総時間がタイムラインと一致する', () => {
    expect(plan.totalSec).toBe(7 * MIN);
  });
});

describe('空のタイムライン', () => {
  it('壊れずに空のプランを返す', () => {
    const plan = buildTimelinePlan({ entries: [], totalSec: 0 });
    expect(plan.totalSec).toBe(0);
    expect(plan.carrier.left).toEqual([]);
    expect(plan.chimes).toEqual([]);
  });
});
