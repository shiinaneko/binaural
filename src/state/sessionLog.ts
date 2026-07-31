/**
 * セッションの記録（SPEC.md §10）。
 *
 * 仕様では IndexedDB としていたが、1 件あたり 100 バイト程度・年に数百件の規模なので
 * localStorage で十分と判断した。件数が増えたら移行する。
 * データはこの端末内にのみ保存され、外部には送信されない。
 */

import type { SessionLogEntry } from '../audio/types';

const KEY = 'binaural-studio/log/v1';
/** 保持する最大件数（古いものから捨てる） */
const MAX_ENTRIES = 500;

export interface LogEntry extends SessionLogEntry {
  presetName: string;
}

export function loadLog(): LogEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as LogEntry[]) : [];
  } catch {
    return [];
  }
}

export function appendLog(entry: LogEntry): LogEntry[] {
  const entries = [...loadLog(), entry].slice(-MAX_ENTRIES);
  try {
    localStorage.setItem(KEY, JSON.stringify(entries));
  } catch {
    // 書けなくても再生には影響しない
  }
  return entries;
}

export function clearLog(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // 何もしない
  }
}

export interface LogSummary {
  totalSec: number;
  sessionCount: number;
  completedCount: number;
  /** 今日を含む連続日数 */
  streakDays: number;
  /** 直近 7 日の合計秒 */
  lastWeekSec: number;
}

function dayKey(iso: string): string {
  // ローカル時刻の日付で数える（深夜に日をまたぐ体感に合わせる）
  const date = new Date(iso);
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

function shiftDays(base: Date, days: number): string {
  const date = new Date(base);
  date.setDate(date.getDate() - days);
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

export function summarize(entries: LogEntry[], now = new Date()): LogSummary {
  const days = new Set(entries.map((e) => dayKey(e.startedAt)));

  // 今日から遡って、記録のある日が続く限り数える。
  // 今日がまだなら昨日を起点にする（朝いちで連続が途切れて見えないように）
  let streakDays = 0;
  let offset = days.has(shiftDays(now, 0)) ? 0 : 1;
  if (offset === 1 && !days.has(shiftDays(now, 1))) {
    streakDays = 0;
  } else {
    while (days.has(shiftDays(now, offset))) {
      streakDays++;
      offset++;
    }
  }

  const weekAgo = now.getTime() - 7 * 24 * 3600 * 1000;
  const lastWeekSec = entries
    .filter((e) => new Date(e.startedAt).getTime() >= weekAgo)
    .reduce((sum, e) => sum + e.completedSec, 0);

  return {
    totalSec: entries.reduce((sum, e) => sum + e.completedSec, 0),
    sessionCount: entries.length,
    completedCount: entries.filter((e) => e.completed).length,
    streakDays,
    lastWeekSec,
  };
}
