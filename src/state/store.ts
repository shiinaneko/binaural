/**
 * UI 状態。オーディオの実体は controller.ts が持ち、こちらは表示用の写しだけを保持する。
 * 依存の向きは UI → controller → store の一方通行（store は controller を import しない）。
 */

import { create } from 'zustand';
import type { AmbienceId, SegmentKind, SessionPreset } from '../audio/types';
import type { SessionPhase } from '../audio/SessionScheduler';
import { loadMyPresets } from './myPresets';
import { loadLog, type LogEntry } from './sessionLog';
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type PersistedSettings } from './persistence';

export type View = 'home' | 'session' | 'headphone' | 'settings' | 'export' | 'studio';
export type SessionStatus = 'idle' | 'running' | 'paused' | 'completed';

export interface Runtime {
  status: SessionStatus;
  elapsedSec: number;
  remainingSec: number;
  totalSec: number;
  progress: number;
  beatHz: number;
  carrierHz: number;
  phase: SessionPhase;
  segmentIndex: number;
  segmentCount: number;
  segmentKind: SegmentKind;
  segmentRemainingSec: number;
}

const IDLE_RUNTIME: Runtime = {
  status: 'idle',
  elapsedSec: 0,
  remainingSec: 0,
  totalSec: 0,
  progress: 0,
  beatHz: 0,
  carrierHz: 0,
  phase: 'plateau',
  segmentIndex: 0,
  segmentCount: 0,
  segmentKind: 'focus',
  segmentRemainingSec: 0,
};

export interface AppState extends PersistedSettings {
  view: View;
  dimmed: boolean;
  runtime: Runtime;
  /**
   * 編集中のプリセット。設定されている間は、再生も書き出しもこれを使う
   * （プレビューと書き出しが必ず同じものを指すようにするため）。
   */
  draft: SessionPreset | null;
  myPresets: SessionPreset[];
  log: LogEntry[];
  /** 未実装レイヤーを代替再生している場合の内容（UI に明示する） */
  substitutions: Array<{ from: AmbienceId; to: AmbienceId }>;
  /** オーディオ関連のエラーメッセージ */
  error: string | null;
  /**
   * 実際に使われている出力方式。
   * media-element ならバックグラウンド再生が期待できる。実機での切り分け用に見せる。
   */
  outputMode: 'media-element' | 'direct' | 'unknown';

  setView(view: View): void;
  selectPreset(id: string): void;
  setDraft(preset: SessionPreset | null): void;
  refreshMyPresets(): void;
  refreshLog(): void;
  setPomodoro(enabled: boolean): void;
  setCycles(cycles: number): void;
  setVolumeState(volume: number): void;
  setChimeEnabled(enabled: boolean): void;
  setWakeLockEnabled(enabled: boolean): void;
  setDimmed(dimmed: boolean): void;
  acknowledgeSafety(): void;
  markHeadphoneChecked(): void;
  patchRuntime(patch: Partial<Runtime>): void;
  resetRuntime(): void;
  setSubstitutions(subs: Array<{ from: AmbienceId; to: AmbienceId }>): void;
  setError(message: string | null): void;
  setOutputMode(mode: AppState['outputMode']): void;
}

const initial = typeof localStorage === 'undefined' ? DEFAULT_SETTINGS : loadSettings();

function persist(state: AppState): void {
  saveSettings({
    volume: state.volume,
    presetId: state.presetId,
    pomodoro: state.pomodoro,
    cycles: state.cycles,
    safetyAcknowledged: state.safetyAcknowledged,
    headphoneChecked: state.headphoneChecked,
    chimeEnabled: state.chimeEnabled,
    wakeLockEnabled: state.wakeLockEnabled,
  });
}

export const useAppStore = create<AppState>((set, get) => ({
  ...initial,
  view: 'home',
  dimmed: false,
  runtime: IDLE_RUNTIME,
  draft: null,
  myPresets: typeof localStorage === 'undefined' ? [] : loadMyPresets(),
  log: typeof localStorage === 'undefined' ? [] : loadLog(),
  substitutions: [],
  error: null,
  outputMode: 'unknown',

  setView: (view) => set({ view }),

  selectPreset: (presetId) => {
    // 組み込みプリセットを選んだら編集中の下書きは畳む
    const draft = get().myPresets.find((p) => p.id === presetId) ?? null;
    set({ presetId, draft });
    persist(get());
  },

  setDraft: (draft) => {
    set({ draft, ...(draft ? { presetId: draft.id } : {}) });
    if (draft) persist(get());
  },

  refreshMyPresets: () => set({ myPresets: loadMyPresets() }),

  refreshLog: () => set({ log: loadLog() }),

  setPomodoro: (pomodoro) => {
    set({ pomodoro });
    persist(get());
  },

  setCycles: (cycles) => {
    set({ cycles: Math.min(Math.max(Math.round(cycles), 2), 8) });
    persist(get());
  },

  setVolumeState: (volume) => {
    set({ volume: Math.min(Math.max(volume, 0), 1) });
    persist(get());
  },

  setChimeEnabled: (chimeEnabled) => {
    set({ chimeEnabled });
    persist(get());
  },

  setWakeLockEnabled: (wakeLockEnabled) => {
    set({ wakeLockEnabled });
    persist(get());
  },

  setDimmed: (dimmed) => set({ dimmed }),

  acknowledgeSafety: () => {
    set({ safetyAcknowledged: true });
    persist(get());
  },

  markHeadphoneChecked: () => {
    set({ headphoneChecked: true });
    persist(get());
  },

  patchRuntime: (patch) => set({ runtime: { ...get().runtime, ...patch } }),

  resetRuntime: () => set({ runtime: IDLE_RUNTIME }),

  setSubstitutions: (substitutions) => set({ substitutions }),

  setError: (error) => set({ error }),

  setOutputMode: (outputMode) => set({ outputMode }),
}));
