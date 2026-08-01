/**
 * 書き出し画面（SPEC.md §7.1-4）。
 *
 * 25 分の WAV は 275 MB を超えるので、サイズ見積は必ず先に出す。
 */

import { useMemo, useRef, useState } from 'react';
import { valueAt } from '../audio/breakpoints';
import { buildTimeline } from '../audio/SessionScheduler';
import { buildTimelinePlan } from '../audio/timelinePlan';
import {
  estimateExportBytes,
  planLoopDuration,
  renderSessionToWav,
} from '../audio/render/OfflineRenderer';
import type { BitDepth } from '../audio/render/wav';
import { buildRunnablePreset } from '../state/controller';
import { useAppStore } from '../state/store';
import { formatClock, formatMinutes } from './format';
import { useT } from './useT';

type Status = 'idle' | 'rendering' | 'done' | 'error';

function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`;
  return `${Math.round(bytes / 1e6)} MB`;
}

export function Export() {
  const t = useT();
  const setView = useAppStore((s) => s.setView);
  const presetId = useAppStore((s) => s.presetId);
  const pomodoro = useAppStore((s) => s.pomodoro);
  const cycles = useAppStore((s) => s.cycles);

  const [bitDepth, setBitDepth] = useState<BitDepth>(16);
  const [seamlessLoop, setSeamlessLoop] = useState(false);
  const [status, setStatus] = useState<Status>('idle');
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [result, setResult] = useState<{ url: string; fileName: string; bytes: number } | null>(
    null,
  );
  const abortRef = useRef<AbortController | null>(null);

  // プリセット・ポモドーロ設定が変わったら作り直す
  const { preset, plan } = useMemo(() => {
    const runnable = buildRunnablePreset();
    return { preset: runnable.preset, plan: buildTimelinePlan(buildTimeline(runnable.preset)) };
  }, [presetId, pomodoro, cycles]);

  const loop = planLoopDuration(
    plan.totalSec,
    valueAt(plan.carrier.left, 0),
    valueAt(plan.carrier.right, 0),
  );
  const durationSec = seamlessLoop ? loop.durationSec : plan.totalSec;
  const estimatedBytes = estimateExportBytes({ durationSec, bitDepth });

  const start = async () => {
    if (result) URL.revokeObjectURL(result.url);
    setResult(null);
    setStatus('rendering');
    setProgress(0);
    setMessage(null);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const rendered = await renderSessionToWav({
        preset,
        bitDepth,
        seamlessLoop,
        signal: controller.signal,
        onProgress: setProgress,
      });
      setResult({
        url: URL.createObjectURL(rendered.blob),
        fileName: rendered.fileName,
        bytes: rendered.bytes,
      });
      setStatus('done');
      setMessage(
        t('export.done', {
          time: formatClock(rendered.durationSec),
          sec: rendered.renderSec.toFixed(1),
        }),
      );
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setStatus('idle');
        setMessage(t('export.aborted'));
      } else {
        setStatus('error');
        setMessage(err instanceof Error ? err.message : t('export.failed'));
      }
    } finally {
      abortRef.current = null;
    }
  };

  return (
    <>
      <div className="topbar">
        <h1 className="brand">
          {t('export.title')} <span>/ WAV</span>
        </h1>
        <button
          className="btn btn-ghost"
          onClick={() => setView('home')}
          disabled={status === 'rendering'}
        >
          {t('common.back')}
        </button>
      </div>

      <ul className="list-plain">
        <li className="card">
          <div className="row-between">
            <strong>{preset.name}</strong>
            <span className="faint">{formatMinutes(durationSec, t)}</span>
          </div>
        </li>

        <li className="card">
          <div className="row-between">
            <span>{t('export.bitDepth')}</span>
            <div className="chips">
              {([16, 24] as BitDepth[]).map((depth) => (
                <button
                  key={depth}
                  className="btn"
                  aria-pressed={bitDepth === depth}
                  onClick={() => setBitDepth(depth)}
                  disabled={status === 'rendering'}
                  style={
                    bitDepth === depth
                      ? { borderColor: 'var(--accent)', color: 'var(--accent)' }
                      : undefined
                  }
                >
                  {depth} bit
                </button>
              ))}
            </div>
          </div>
          <p className="faint" style={{ margin: '10px 0 0' }}>
            {t('export.formatNote')}
          </p>
        </li>

        <li className="card">
          <label className="switch">
            <input
              type="checkbox"
              checked={seamlessLoop}
              onChange={(e) => setSeamlessLoop(e.target.checked)}
              disabled={status === 'rendering'}
            />
            <span>
              {t('export.loop')}
              <span className="faint"> — {t('export.loopHint')}</span>
            </span>
          </label>
          {seamlessLoop && (
            <p className="faint" style={{ margin: '10px 0 0' }}>
              {t('export.loopNote', { time: formatClock(loop.durationSec) })}{' '}
              {loop.phaseErrorDeg > 5
                ? t('export.loopPhaseWarn', { deg: Math.round(loop.phaseErrorDeg) })
                : t('export.loopPhaseOk')}
            </p>
          )}
        </li>

        <li className="card">
          <div className="row-between">
            <span>{t('export.size')}</span>
            <strong style={{ fontVariantNumeric: 'tabular-nums' }}>
              {formatBytes(estimatedBytes)}
            </strong>
          </div>
          {estimatedBytes > 500e6 && (
            <p className="faint" style={{ margin: '8px 0 0' }}>
              {t('export.sizeWarn')}
            </p>
          )}
        </li>

        {status === 'rendering' && (
          <li className="card">
            <div className="row-between">
              <span>{progress === 0 ? t('export.preparing') : t('export.rendering')}</span>
              <span className="faint" style={{ fontVariantNumeric: 'tabular-nums' }}>
                {Math.round(progress * 100)}%
              </span>
            </div>
            <div
              style={{
                marginTop: 10,
                height: 6,
                borderRadius: 999,
                background: 'var(--line)',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  width: `${progress * 100}%`,
                  height: '100%',
                  background: 'var(--accent)',
                  transition: 'width 0.3s linear',
                }}
              />
            </div>
          </li>
        )}

        {message && (
          <li className={status === 'error' ? 'error' : 'card'}>
            <span className={status === 'error' ? undefined : 'faint'}>{message}</span>
          </li>
        )}

        {result && (
          <li className="card">
            <div className="row-between">
              <div>
                <div style={{ fontSize: 13.5, wordBreak: 'break-all' }}>{result.fileName}</div>
                <div className="faint">{formatBytes(result.bytes)}</div>
              </div>
              <a className="btn btn-primary" href={result.url} download={result.fileName}>
                {t('export.save')}
              </a>
            </div>
          </li>
        )}

        <li className="card">
          <p className="faint" style={{ margin: 0 }}>
            {t('export.privacy')}
          </p>
        </li>
      </ul>

      <div className="start-row">
        {status === 'rendering' ? (
          <button className="btn btn-danger" onClick={() => abortRef.current?.abort()}>
            {t('export.abort')}
          </button>
        ) : (
          <button className="btn btn-primary" onClick={() => void start()}>
            {t('export.start')}
          </button>
        )}
      </div>
    </>
  );
}
