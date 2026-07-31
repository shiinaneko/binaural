/**
 * 設定の永続化（SPEC.md §10）。
 * localStorage のみを使い、外部送信は一切しない。
 */

export interface PersistedSettings {
  volume: number;
  presetId: string;
  pomodoro: boolean;
  cycles: number;
  safetyAcknowledged: boolean;
  headphoneChecked: boolean;
  chimeEnabled: boolean;
  wakeLockEnabled: boolean;
}

const KEY = 'binaural-studio/settings/v1';

export const DEFAULT_SETTINGS: PersistedSettings = {
  volume: 0.55,
  presetId: 'deep-work',
  pomodoro: false,
  cycles: 4,
  safetyAcknowledged: false,
  headphoneChecked: false,
  chimeEnabled: true,
  wakeLockEnabled: true,
};

export function loadSettings(): PersistedSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<PersistedSettings>;
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: PersistedSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // プライベートモード等で書けない場合は黙って諦める（機能は動く）
  }
}
