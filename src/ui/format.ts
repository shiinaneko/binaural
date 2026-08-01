import type { Translate } from '../i18n';
import type { AmbienceId, Band, BeatMode, SegmentKind } from '../audio/types';
import type { SessionPhase } from '../audio/SessionScheduler';

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

/** 秒 → 「25 分」/「25 min」 */
export function formatMinutes(totalSec: number, t: Translate): string {
  return t('common.minutes', { n: Math.round(totalSec / 60) });
}

export function formatHz(hz: number, digits = 2): string {
  return `${hz.toFixed(digits)} Hz`;
}

export const segmentLabel = (kind: SegmentKind, t: Translate): string =>
  t(`segment.${kind}` as const);

export const phaseLabel = (phase: SessionPhase, t: Translate): string =>
  t(`phase.${phase}` as const);

export const modeLabel = (mode: BeatMode, t: Translate): string => t(`mode.${mode}` as const);

export const bandLabel = (band: Band, t: Translate): string => t(`band.${band}` as const);

export const ambienceLabel = (id: AmbienceId, t: Translate): string =>
  t(`ambience.${id}` as const);
