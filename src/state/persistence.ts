/**
 * 設定の永続化（SPEC.md §10）。
 * localStorage のみを使い、外部送信は一切しない。
 */

import { detectLanguage, type Lang } from '../i18n';

export interface PersistedSettings {
  language: Lang;
  volume: number;
  presetId: string;
  pomodoro: boolean;
  cycles: number;
  safetyAcknowledged: boolean;
  headphoneChecked: boolean;
  chimeEnabled: boolean;
  wakeLockEnabled: boolean;
  /**
   * バックグラウンド維持用の音を Web Audio に取り込み、出力を 1 本にまとめるか。
   * 端末によっては 2 本のストリームの混合で音が途切れるため、切り替えられるようにしている。
   */
  mergeOutput: boolean;
}

const KEY = 'binaural-studio/settings/v1';

export const DEFAULT_SETTINGS: PersistedSettings = {
  // 初回は端末の言語に合わせる。以降は保存された値が優先される
  language: detectLanguage(),
  volume: 0.55,
  presetId: 'deep-work',
  pomodoro: false,
  cycles: 4,
  safetyAcknowledged: false,
  headphoneChecked: false,
  chimeEnabled: true,
  wakeLockEnabled: true,
  // 既定で有効。実機（Android + Bluetooth）で、別々の出力にすると
  // キープアライブのループ周期（30 秒）ごとに音が途切れたため。
  // 加算による影響は実測で確認済み: Δf は変化せず、左右分離は 84 dB
  // （アプリ本来の環境音の 62 dB よりさらに小さい影響）
  mergeOutput: true,
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
