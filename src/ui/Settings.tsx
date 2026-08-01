import { useMemo, useState } from 'react';
import { LANGUAGES } from '../i18n';
import { getAudioDiagnostics, setVolume } from '../state/controller';
import { clearLog, summarize } from '../state/sessionLog';
import { useAppStore } from '../state/store';
import { formatClock } from './format';
import { SafetyNotice } from './SafetyNotice';
import { useT } from './useT';

export function Settings() {
  const t = useT();
  const [showSafety, setShowSafety] = useState(false);
  const log = useAppStore((s) => s.log);
  const refreshLog = useAppStore((s) => s.refreshLog);
  const outputMode = useAppStore((s) => s.outputMode);
  const [diagnostics, setDiagnostics] = useState(getAudioDiagnostics);
  const summary = useMemo(() => summarize(log), [log]);

  const volume = useAppStore((s) => s.volume);
  const chimeEnabled = useAppStore((s) => s.chimeEnabled);
  const setChimeEnabled = useAppStore((s) => s.setChimeEnabled);
  const wakeLockEnabled = useAppStore((s) => s.wakeLockEnabled);
  const setWakeLockEnabled = useAppStore((s) => s.setWakeLockEnabled);
  const mergeOutput = useAppStore((s) => s.mergeOutput);
  const setMergeOutput = useAppStore((s) => s.setMergeOutput);
  const language = useAppStore((s) => s.language);
  const setLanguage = useAppStore((s) => s.setLanguage);
  const setView = useAppStore((s) => s.setView);

  return (
    <>
      {showSafety && <SafetyNotice mode="review" onAcknowledge={() => setShowSafety(false)} />}

      <div className="topbar">
        <h1 className="brand">{t('settings.title')}</h1>
        <button className="btn btn-ghost" onClick={() => setView('home')}>
          {t('common.back')}
        </button>
      </div>

      <ul className="list-plain">
        <li className="card">
          <div className="row-between">
            <span>{t('settings.language')}</span>
            <div className="chips">
              {LANGUAGES.map((option) => (
                <button
                  key={option.id}
                  className="btn"
                  aria-pressed={language === option.id}
                  onClick={() => setLanguage(option.id)}
                  style={
                    language === option.id
                      ? { borderColor: 'var(--accent)', color: 'var(--accent)' }
                      : undefined
                  }
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </li>

        <li className="card">
          <div className="row">
            <span className="faint" style={{ minWidth: '4em' }}>
              {t('home.volume')}
            </span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={volume}
              onChange={(e) => setVolume(Number(e.target.value))}
              aria-label={t('home.volume')}
            />
            <span className="faint" style={{ minWidth: '3em', textAlign: 'right' }}>
              {Math.round(volume * 100)}%
            </span>
          </div>
          <p className="faint" style={{ margin: '8px 0 0' }}>
            {t('settings.volumeNote')}
          </p>
        </li>

        <li className="card">
          <label className="switch">
            <input
              type="checkbox"
              checked={chimeEnabled}
              onChange={(e) => setChimeEnabled(e.target.checked)}
            />
            <span>
              {t('settings.chime')}
              <span className="faint"> — {t('settings.chimeHint')}</span>
            </span>
          </label>
        </li>

        <li className="card">
          <label className="switch">
            <input
              type="checkbox"
              checked={mergeOutput}
              onChange={(e) => setMergeOutput(e.target.checked)}
            />
            <span>
              {t('settings.mergeOutput')}
              <span className="faint"> — {t('settings.mergeOutputHint')}</span>
            </span>
          </label>
          <p className="faint" style={{ margin: '10px 0 0' }}>
            {t('settings.mergeOutputNote')}
            <br />
            {t('settings.mergeOutputMeasured')}
          </p>
        </li>

        <li className="card">
          <label className="switch">
            <input
              type="checkbox"
              checked={wakeLockEnabled}
              onChange={(e) => setWakeLockEnabled(e.target.checked)}
            />
            <span>
              {t('settings.wakeLock')}
              <span className="faint"> — {t('settings.wakeLockHint')}</span>
            </span>
          </label>
          {outputMode !== 'unknown' && (
            <p className="faint" style={{ margin: '10px 0 0' }}>
              {t('settings.backgroundKept')}:{' '}
              <b>{outputMode === 'keepalive' ? t('settings.enabled') : t('settings.disabled')}</b>{' '}
              {outputMode === 'keepalive' ? t('settings.backgroundOk') : t('settings.backgroundNg')}
            </p>
          )}
        </li>

        <li className="card">
          <div className="row-between">
            <span>{t('settings.safety')}</span>
            <button className="btn" onClick={() => setShowSafety(true)}>
              {t('common.show')}
            </button>
          </div>
        </li>

        <li className="card">
          <div className="row-between">
            <span>{t('common.headphoneCheck')}</span>
            <button className="btn" onClick={() => setView('headphone')}>
              {t('common.redo')}
            </button>
          </div>
        </li>

        <li className="card">
          <div className="row-between">
            <span>{t('settings.records')}</span>
            {log.length > 0 && (
              <button
                className="btn btn-ghost"
                onClick={() => {
                  clearLog();
                  refreshLog();
                }}
              >
                {t('common.clearAll')}
              </button>
            )}
          </div>
          {log.length === 0 ? (
            <p className="faint" style={{ margin: '8px 0 0' }}>
              {t('settings.noRecords')}
            </p>
          ) : (
            <>
              <div className="spec-row" style={{ marginTop: 10 }}>
                <span>
                  <b>{t('settings.streak', { n: summary.streakDays })}</b>
                </span>
                <span>{t('settings.thisWeek', { n: Math.round(summary.lastWeekSec / 60) })}</span>
                <span>{t('settings.total', { n: Math.round(summary.totalSec / 3600) })}</span>
                <span>
                  {t('settings.completedCount', {
                    done: summary.completedCount,
                    all: summary.sessionCount,
                  })}
                </span>
              </div>
              <ul className="list-plain" style={{ marginTop: 12, gap: 6 }}>
                {[...log]
                  .reverse()
                  .slice(0, 8)
                  .map((entry, index) => (
                    <li key={index} className="row-between faint" style={{ fontSize: 12.5 }}>
                      <span>
                        {new Date(entry.startedAt).toLocaleString(language, {
                          month: 'numeric',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}{' '}
                        {entry.presetName}
                      </span>
                      <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                        {formatClock(entry.completedSec)}
                        {entry.completed ? '' : t('settings.interrupted')}
                      </span>
                    </li>
                  ))}
              </ul>
            </>
          )}
        </li>

        <li className="card">
          <p className="faint" style={{ margin: 0 }}>
            {t('settings.privacy')}
          </p>
        </li>

        {/* 切り分け用なので、普段は畳んでおく */}
        <li className="card">
          <details onToggle={() => setDiagnostics(getAudioDiagnostics())}>
            <summary className="disclosure">{t('settings.diagnostics')}</summary>
            <p className="faint" style={{ margin: '10px 0' }}>
              {t('settings.diagnosticsHint')}
            </p>
            <div className="row-between" style={{ marginBottom: 10 }}>
              <span className="faint" style={{ fontSize: 12.5 }}>
                {diagnostics.buildId}
              </span>
              <button
                className="btn btn-ghost"
                onClick={() => setDiagnostics(getAudioDiagnostics())}
              >
                {t('common.refresh')}
              </button>
            </div>
            <dl className="diagnostics">
              <dt>{t('settings.diag.build')}</dt>
              <dd>{diagnostics.buildId}</dd>
              <dt>{t('settings.diag.background')}</dt>
              <dd>
                {diagnostics.outputMode === 'keepalive'
                  ? t('settings.enabled')
                  : diagnostics.outputMode === 'direct'
                    ? t('settings.disabled')
                    : t('settings.diag.notPlayedYet')}
              </dd>
              {diagnostics.keepaliveError && (
                <>
                  <dt>{t('settings.diag.failReason')}</dt>
                  <dd>{diagnostics.keepaliveError}</dd>
                </>
              )}
              <dt>{t('settings.diag.keepalive')}</dt>
              <dd>
                {diagnostics.keepalivePaused === null
                  ? t('settings.diag.notCreated')
                  : diagnostics.keepalivePaused
                    ? t('settings.diag.paused')
                    : t('settings.diag.playing')}
                {diagnostics.keepaliveMerged ? t('settings.diag.merged') : ''}
              </dd>
              <dt>{t('settings.diag.context')}</dt>
              <dd>
                {diagnostics.contextState ?? t('settings.diag.notCreated')}
                {diagnostics.sampleRate ? ` / ${diagnostics.sampleRate} Hz` : ''}
              </dd>
              <dt>{t('settings.diag.mediaSession')}</dt>
              <dd>
                {diagnostics.mediaSessionSupported
                  ? t('settings.diag.supported')
                  : t('settings.diag.unsupported')}
              </dd>
              <dt>{t('settings.diag.wakeLock')}</dt>
              <dd>
                {diagnostics.wakeLockSupported
                  ? t('settings.diag.supported')
                  : t('settings.diag.unsupported')}
              </dd>
              <dt>{t('settings.diag.serviceWorker')}</dt>
              <dd>
                {diagnostics.serviceWorkerControlled
                  ? t('settings.diag.active')
                  : t('settings.diag.inactive')}
              </dd>
              <dt>{t('settings.diag.displayMode')}</dt>
              <dd>
                {diagnostics.standalone
                  ? t('settings.diag.standalone')
                  : t('settings.diag.browserTab')}
              </dd>
            </dl>
          </details>
        </li>
      </ul>
    </>
  );
}
