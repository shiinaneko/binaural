/**
 * セッション画面（SPEC.md §7.1-2）。情報を削ぎ落とし、残り時間と現在の状態だけを見せる。
 */

import { bandForBeatHz } from '../audio/carrier';
import { skipSegment, stopSession, togglePause } from '../state/controller';
import { useAppStore } from '../state/store';
import { findPreset } from '../presets/sessions';
import { bandLabel, formatClock, formatHz, phaseLabel, segmentLabel } from './format';
import { ProgressRing } from './ProgressRing';
import { useT } from './useT';

export function SessionView() {
  const t = useT();
  const runtime = useAppStore((s) => s.runtime);
  const dimmed = useAppStore((s) => s.dimmed);
  const setDimmed = useAppStore((s) => s.setDimmed);
  const presetId = useAppStore((s) => s.presetId);
  const draft = useAppStore((s) => s.draft);
  const setView = useAppStore((s) => s.setView);
  const resetRuntime = useAppStore((s) => s.resetRuntime);

  const preset = draft ?? findPreset(presetId);
  const band = bandLabel(bandForBeatHz(runtime.beatHz), t);
  const multiSegment = runtime.segmentCount > 1;

  if (dimmed) {
    return (
      <button className="dim-overlay" onClick={() => setDimmed(false)} aria-label={t('session.dimAria')}>
        <div className="clock">{formatClock(runtime.remainingSec)}</div>
        <div className="clock-sub">{t('session.tapToReturn')}</div>
      </button>
    );
  }

  if (runtime.status === 'completed') {
    return (
      <div className="session">
        <h2 style={{ margin: 0, fontWeight: 400 }}>{t('session.completed')}</h2>
        <p className="muted" style={{ margin: 0 }}>
          {preset?.name} · {formatClock(runtime.totalSec)}
        </p>
        <div className="controls">
          <button
            className="btn btn-primary"
            onClick={() => {
              resetRuntime();
              setView('home');
            }}
          >
            {t('session.backHome')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="session">
      <ProgressRing progress={runtime.progress}>
        <div className="clock">{formatClock(runtime.remainingSec)}</div>
        <div className="clock-sub">
          {multiSegment
            ? `${segmentLabel(runtime.segmentKind, t)} · ${t('session.remaining', {
                time: formatClock(runtime.segmentRemainingSec),
              })}`
            : preset?.name}
        </div>
      </ProgressRing>

      <div>
        <div className="beat-readout">
          <span className="beat-hz">{formatHz(runtime.beatHz, 2)}</span>
          <span className="muted">{band}</span>
        </div>
        <p className="faint" style={{ margin: '4px 0 0' }}>
          {phaseLabel(runtime.phase, t)}
          {multiSegment && ` · ${runtime.segmentIndex + 1} / ${runtime.segmentCount}`}
          {runtime.carrierHz > 0 && ` · ${t('session.carrierAt', { hz: runtime.carrierHz })}`}
        </p>
      </div>

      <div className="controls">
        <button className="btn" onClick={() => void togglePause()}>
          {runtime.status === 'paused' ? t('session.resume') : t('session.pause')}
        </button>
        {multiSegment && (
          <button className="btn" onClick={skipSegment}>
            {t('session.nextSegment')}
          </button>
        )}
        <button className="btn" onClick={() => setDimmed(true)}>
          {t('session.dim')}
        </button>
        <button className="btn btn-danger" onClick={() => void stopSession()}>
          {t('session.stop')}
        </button>
      </div>

      <p className="faint" style={{ margin: 0 }}>
        {t('session.keys')}
      </p>
    </div>
  );
}
