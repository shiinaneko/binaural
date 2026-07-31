/** 秒 → mm:ss（1 時間以上は h:mm:ss） */
export function formatClock(totalSec: number): string {
  const s = Math.max(0, Math.ceil(totalSec));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** 秒 → 「25 分」表記 */
export function formatMinutes(totalSec: number): string {
  return `${Math.round(totalSec / 60)} 分`;
}

export function formatHz(hz: number, digits = 2): string {
  return `${hz.toFixed(digits)} Hz`;
}

export const SEGMENT_LABELS = {
  focus: '集中',
  shortBreak: '小休憩',
  longBreak: '長休憩',
} as const;

export const PHASE_LABELS = {
  onset: '導入',
  plateau: '保持',
  taper: '収束',
} as const;

export const MODE_LABELS = {
  binaural: 'バイノーラル',
  monaural: 'モノラルビート',
  isochronic: 'アイソクロニック',
  hybrid: 'ハイブリッド',
} as const;
