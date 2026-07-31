/**
 * オーディオの実体を持つコントローラ（UI からのコマンドの入口）。
 *
 * - AudioContext / AudioEngine / SessionScheduler はここだけが保持する
 * - 250ms ごとの ticker は「先読みスケジュールの延長」と「表示値の更新」のみを担い、
 *   時間の正確さはオーディオクロックが担保する（SPEC.md §6）
 */

import { AudioEngine } from '../audio/AudioEngine';
import { buildTimeline, SessionScheduler } from '../audio/SessionScheduler';
import { resolveAmbienceMix } from '../audio/layers/fallback';
import { playTestTone, type TestToneHandle, type TestToneOptions } from '../audio/testTone';
import type { AmbienceId, SessionPreset } from '../audio/types';
import { BUILT_IN_PRESETS, findPreset, toPomodoro } from '../presets/sessions';
import { appendLog } from './sessionLog';
import { useAppStore } from './store';

const TICK_MS = 250;

let ctx: AudioContext | null = null;
let engine: AudioEngine | null = null;
let scheduler: SessionScheduler | null = null;
let ticker: number | null = null;
let wakeLock: { release(): Promise<void> } | null = null;
/** バックグラウンド再生を維持するための出力先 */
let mediaElement: HTMLAudioElement | null = null;
/** メディア要素経由に失敗した理由（実機での切り分け用） */
let mediaSinkError: string | null = null;
/** 記録中のセッション。終了時にログへ書き出す */
let pendingLog: { presetId: string; presetName: string; startedAt: string; plannedSec: number } | null =
  null;

/**
 * セッションの記録を残す。終了経路（完走・中断）が 2 つあるので、
 * どちらからも必ずここを通す。二重記録を防ぐため pendingLog は使い捨て。
 */
function commitLog(completed: boolean): void {
  if (!pendingLog) return;
  const elapsed = scheduler ? Math.min(scheduler.elapsedSec, pendingLog.plannedSec) : 0;
  appendLog({
    presetId: pendingLog.presetId,
    presetName: pendingLog.presetName,
    startedAt: pendingLog.startedAt,
    plannedSec: pendingLog.plannedSec,
    completedSec: Math.round(elapsed),
    completed,
  });
  pendingLog = null;
  useAppStore.getState().refreshLog();
}

// ---------------------------------------------------------------------------
// AudioContext
// ---------------------------------------------------------------------------

/** 自動再生ポリシーのため、必ずユーザー操作の延長で呼ぶこと。 */
export async function ensureContext(): Promise<AudioContext> {
  if (!ctx) {
    // latencyHint: 'playback' はバッファを大きく取り、長時間再生の CPU 負荷とドロップアウトを減らす
    ctx = new AudioContext({ latencyHint: 'playback' });
    ctx.onstatechange = () => {
      const state = ctx?.state;
      if (state === 'interrupted' as AudioContextState) {
        useAppStore.getState().setError('オーディオが中断されました。再開してください。');
      }
    };
  }
  if (ctx.state === 'suspended') {
    await ctx.resume();
  }
  return ctx;
}

// ---------------------------------------------------------------------------
// バックグラウンド再生（SPEC.md §6）
// ---------------------------------------------------------------------------

/**
 * 素の Web Audio（ctx.destination）は、Android Chrome で画面ロックや
 * アプリ切り替えをすると止まってしまう（実機で確認済み）。
 *
 * そこで音声を MediaStreamAudioDestinationNode → `<audio>` 要素に流す。
 * ブラウザから「メディア再生」として扱われるため、バックグラウンドでも維持され、
 * ロック画面の再生コントロール（MediaSession）とも自然に噛み合う。
 *
 * この経路が左右の位相を壊さないことは実測で確認した:
 * 左 312.01 Hz / 右 328.13 Hz、チャンネル分離 91.5 dB / 112.1 dB。
 * 非対応環境では従来どおり ctx.destination へフォールバックする。
 */
async function createMediaSink(
  context: AudioContext,
): Promise<MediaStreamAudioDestinationNode | null> {
  if (typeof context.createMediaStreamDestination !== 'function') {
    mediaSinkError = 'createMediaStreamDestination が無い';
    return null;
  }

  try {
    const destination = context.createMediaStreamDestination();
    const element = new Audio();
    element.srcObject = destination.stream;
    // iOS でインライン再生させるための指定（Android では無害）
    element.setAttribute('playsinline', '');
    element.volume = 1;
    // DOM に入れておく。ブラウザによっては、文書に属していないメディア要素を
    // 「再生中のメディア」として扱わないことがある
    element.style.display = 'none';
    document.body.appendChild(element);

    // OS や他アプリの操作で外から止められた場合に、表示と実態を合わせる
    element.addEventListener('pause', () => {
      if (useAppStore.getState().runtime.status === 'running') void togglePause();
    });

    // **成功を確認してから採用する。** play() が拒否されたのに
    // この経路を使ってしまうと、出力先がどこにも繋がらず完全な無音になる。
    await element.play();

    mediaElement = element;
    mediaSinkError = null;
    return destination;
  } catch (err) {
    mediaSinkError = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    releaseMediaSink();
    return null;
  }
}

function releaseMediaSink(): void {
  if (!mediaElement) return;
  mediaElement.pause();
  mediaElement.srcObject = null;
  mediaElement.remove();
  mediaElement = null;
}

async function ensureEngine(context: AudioContext): Promise<AudioEngine> {
  if (!engine) {
    const sink = await createMediaSink(context);
    useAppStore.getState().setOutputMode(sink ? 'media-element' : 'direct');
    engine = new AudioEngine(context, {
      volume: useAppStore.getState().volume,
      ...(sink ? { sink } : {}),
    });
  }
  return engine;
}

/** 実機での切り分け用。設定画面に出す。 */
export interface AudioDiagnostics {
  buildId: string;
  outputMode: string;
  mediaSinkError: string | null;
  mediaElementPaused: boolean | null;
  contextState: string | null;
  sampleRate: number | null;
  mediaSessionSupported: boolean;
  wakeLockSupported: boolean;
  serviceWorkerControlled: boolean;
  standalone: boolean;
}

export function getAudioDiagnostics(): AudioDiagnostics {
  const nav = navigator as Navigator & WakeLockNavigator;
  return {
    buildId: __BUILD_ID__,
    outputMode: useAppStore.getState().outputMode,
    mediaSinkError,
    mediaElementPaused: mediaElement ? mediaElement.paused : null,
    contextState: ctx?.state ?? null,
    sampleRate: ctx?.sampleRate ?? null,
    mediaSessionSupported: 'mediaSession' in navigator,
    wakeLockSupported: !!nav.wakeLock,
    serviceWorkerControlled:
      'serviceWorker' in navigator && navigator.serviceWorker.controller !== null,
    standalone: window.matchMedia('(display-mode: standalone)').matches,
  };
}

// ---------------------------------------------------------------------------
// プリセットの解決
// ---------------------------------------------------------------------------

interface RunnablePreset {
  preset: SessionPreset;
  substitutions: Array<{ from: AmbienceId; to: AmbienceId }>;
}

/**
 * ストアの設定から実際に再生するプリセットを組み立てる。
 * 未実装の環境音レイヤーは代替に置き換え、置換内容を UI に返す。
 */
export function buildRunnablePreset(): RunnablePreset {
  const { presetId, pomodoro, cycles, chimeEnabled, draft, myPresets } = useAppStore.getState();
  // 編集中の下書きがあれば、再生も書き出しもそれを使う
  const base =
    draft ?? findPreset(presetId) ?? myPresets.find((p) => p.id === presetId) ?? BUILT_IN_PRESETS[0]!;
  const expanded = pomodoro ? toPomodoro(base, { cycles }) : base;

  const seen = new Set<string>();
  const substitutions: Array<{ from: AmbienceId; to: AmbienceId }> = [];
  const segments = expanded.segments.map((segment) => {
    const resolved = resolveAmbienceMix(segment.ambience);
    for (const sub of resolved.substitutions) {
      const key = `${sub.from}->${sub.to}`;
      if (!seen.has(key)) {
        seen.add(key);
        substitutions.push(sub);
      }
    }
    return {
      ...segment,
      ambience: resolved.mix,
      chimeAtEnd: segment.chimeAtEnd && chimeEnabled,
    };
  });

  return { preset: { ...expanded, segments }, substitutions };
}

// ---------------------------------------------------------------------------
// セッション制御
// ---------------------------------------------------------------------------

export async function startSession(): Promise<void> {
  const store = useAppStore.getState();
  try {
    const context = await ensureContext();
    const eng = await ensureEngine(context);
    eng.setVolume(store.volume);

    const { preset, substitutions } = buildRunnablePreset();
    const timeline = buildTimeline(preset);

    scheduler = new SessionScheduler({
      engine: eng,
      timeline,
      onComplete: handleComplete,
    });

    store.setSubstitutions(substitutions);
    store.setError(null);
    store.patchRuntime({
      status: 'running',
      totalSec: timeline.totalSec,
      segmentCount: timeline.entries.length,
      segmentIndex: 0,
      elapsedSec: 0,
      remainingSec: timeline.totalSec,
      progress: 0,
    });
    store.setView('session');

    pendingLog = {
      presetId: preset.id,
      presetName: preset.name,
      startedAt: new Date().toISOString(),
      plannedSec: timeline.totalSec,
    };

    scheduler.start();
    startTicker();
    void requestWakeLock();
    setupMediaSession(preset);
  } catch (err) {
    store.setError(err instanceof Error ? err.message : 'オーディオを開始できませんでした');
  }
}

export async function togglePause(): Promise<void> {
  const store = useAppStore.getState();
  if (!ctx || !scheduler) return;

  if (store.runtime.status === 'running') {
    // 先に状態を更新してから要素を止める。順序を逆にすると、
    // 要素の pause イベントを「外からの停止」と誤認して再帰してしまう
    store.patchRuntime({ status: 'paused' });
    mediaElement?.pause();
    // suspend 中は currentTime が進まないため、スケジュール済みの自動化と経過時間の対応が保たれる
    await ctx.suspend();
    stopTicker();
    void releaseWakeLock();
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused';
  } else if (store.runtime.status === 'paused') {
    await ctx.resume();
    void mediaElement?.play().catch(() => undefined);
    store.patchRuntime({ status: 'running' });
    startTicker();
    void requestWakeLock();
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing';
  }
}

export async function stopSession(): Promise<void> {
  const store = useAppStore.getState();
  if (!scheduler || !ctx) {
    store.resetRuntime();
    store.setView('home');
    return;
  }

  if (ctx.state === 'suspended') await ctx.resume();
  void mediaElement?.play().catch(() => undefined);
  commitLog(false);
  // 先に状態を更新してから、フェードアウトを鳴らしきる
  store.patchRuntime({ status: 'idle' });
  const tail = scheduler.stop(3);
  stopTicker();
  void releaseWakeLock();

  window.setTimeout(
    () => {
      releaseMediaSink();
      engine?.dispose();
      engine = null;
      scheduler = null;
      store.resetRuntime();
      store.setDimmed(false);
      store.setView('home');
    },
    (tail + 0.1) * 1000,
  );

  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'none';
}

export function skipSegment(): void {
  if (!scheduler) return;
  const moved = scheduler.skipToNext();
  if (!moved) void stopSession();
}

export function setVolume(volume: number): void {
  useAppStore.getState().setVolumeState(volume);
  engine?.setVolume(volume);
}

function handleComplete(): void {
  const store = useAppStore.getState();
  commitLog(true);
  store.patchRuntime({ status: 'completed', remainingSec: 0, progress: 1 });
  stopTicker();
  void releaseWakeLock();
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'none';
  // グラフは破棄する（オシレータは既に停止済み）
  window.setTimeout(() => {
    releaseMediaSink();
    engine?.dispose();
    engine = null;
    scheduler = null;
  }, 1000);
}

// ---------------------------------------------------------------------------
// ticker
// ---------------------------------------------------------------------------

function startTicker(): void {
  if (ticker !== null) return;
  ticker = window.setInterval(tick, TICK_MS);
  tick();
}

function stopTicker(): void {
  if (ticker === null) return;
  window.clearInterval(ticker);
  ticker = null;
}

const GRAIN_LOOKAHEAD_SEC = 0.6;

function tick(): void {
  if (!scheduler) return;
  scheduler.tick();
  // 粒（雨など）の先読み。tick 間隔 250ms に対して十分な余裕を取る。
  if (engine) engine.pumpLayers(engine.ctx.currentTime + GRAIN_LOOKAHEAD_SEC);
  const entry = scheduler.currentEntry;
  useAppStore.getState().patchRuntime({
    elapsedSec: scheduler.elapsedSec,
    remainingSec: scheduler.remainingSec,
    totalSec: scheduler.totalSec,
    progress: scheduler.progress,
    beatHz: scheduler.currentBeatHz,
    carrierHz: entry?.segment.beat.carrierHz ?? 0,
    phase: scheduler.phase,
    segmentIndex: entry?.index ?? 0,
    segmentKind: entry?.segment.kind ?? 'focus',
    segmentRemainingSec: scheduler.segmentRemainingSec,
  });
}

/** タブ復帰時に表示を即座に追いつかせる（音はずれていない） */
export function resyncDisplay(): void {
  tick();
}

// ---------------------------------------------------------------------------
// Screen Wake Lock / MediaSession（SPEC.md §6）
// ---------------------------------------------------------------------------

interface WakeLockNavigator {
  wakeLock?: { request(type: 'screen'): Promise<{ release(): Promise<void> }> };
}

async function requestWakeLock(): Promise<void> {
  if (!useAppStore.getState().wakeLockEnabled) return;
  const nav = navigator as Navigator & WakeLockNavigator;
  if (!nav.wakeLock) return;
  try {
    wakeLock = await nav.wakeLock.request('screen');
  } catch {
    // 非対応・拒否された場合は何もしない（画面が消えても音は続く）
  }
}

async function releaseWakeLock(): Promise<void> {
  try {
    await wakeLock?.release();
  } catch {
    // すでに解放済み
  }
  wakeLock = null;
}

/** 画面が隠れると WakeLock は自動解放されるため、復帰時に取り直す */
export function reacquireWakeLockIfNeeded(): void {
  if (useAppStore.getState().runtime.status === 'running' && wakeLock === null) {
    void requestWakeLock();
  }
}

function setupMediaSession(preset: SessionPreset): void {
  if (!('mediaSession' in navigator)) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: preset.name,
    artist: 'Binaural Studio',
    album: preset.description,
  });
  navigator.mediaSession.playbackState = 'playing';
  try {
    navigator.mediaSession.setActionHandler('play', () => void togglePause());
    navigator.mediaSession.setActionHandler('pause', () => void togglePause());
    navigator.mediaSession.setActionHandler('stop', () => void stopSession());
  } catch {
    // 一部のアクションに未対応のブラウザがある
  }
}

// ---------------------------------------------------------------------------
// ヘッドホンチェック
// ---------------------------------------------------------------------------

let testTone: TestToneHandle | null = null;

export async function startTestTone(opts: TestToneOptions): Promise<void> {
  const context = await ensureContext();
  stopTestTone();
  testTone = playTestTone(context, opts);
}

export function stopTestTone(): void {
  testTone?.stop();
  testTone = null;
}
