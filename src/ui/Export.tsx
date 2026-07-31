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

type Status = 'idle' | 'rendering' | 'done' | 'error';

function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`;
  return `${Math.round(bytes / 1e6)} MB`;
}

export function Export() {
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
        `${formatClock(rendered.durationSec)} を ${rendered.renderSec.toFixed(1)} 秒で書き出しました`,
      );
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setStatus('idle');
        setMessage('中断しました');
      } else {
        setStatus('error');
        setMessage(err instanceof Error ? err.message : '書き出しに失敗しました');
      }
    } finally {
      abortRef.current = null;
    }
  };

  return (
    <>
      <div className="topbar">
        <h1 className="brand">
          書き出し <span>/ WAV</span>
        </h1>
        <button className="btn btn-ghost" onClick={() => setView('home')} disabled={status === 'rendering'}>
          戻る
        </button>
      </div>

      <ul className="list-plain">
        <li className="card">
          <div className="row-between">
            <strong>{preset.name}</strong>
            <span className="faint">{formatMinutes(durationSec)}</span>
          </div>
          <p className="muted" style={{ margin: '6px 0 0', fontSize: 13.5 }}>
            {preset.description}
          </p>
        </li>

        <li className="card">
          <div className="row-between">
            <span>ビット深度</span>
            <div className="chips">
              {([16, 24] as BitDepth[]).map((depth) => (
                <button
                  key={depth}
                  className="btn"
                  aria-pressed={bitDepth === depth}
                  onClick={() => setBitDepth(depth)}
                  disabled={status === 'rendering'}
                  style={
                    bitDepth === depth ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : undefined
                  }
                >
                  {depth} bit
                </button>
              ))}
            </div>
          </div>
          <p className="faint" style={{ margin: '10px 0 0' }}>
            48 kHz ステレオ。16 bit には TPDF ディザを掛けます（量子化歪みを聞こえにくくするため）。
            24 bit は量子化ノイズが可聴域に無いのでディザなしです。
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
              ループ用に書き出す
              <span className="faint"> — フェードを省き、環境音のループが揃う長さに丸める</span>
            </span>
          </label>
          {seamlessLoop && (
            <p className="faint" style={{ margin: '10px 0 0' }}>
              長さを {formatClock(loop.durationSec)} に丸めます。環境音のループ位置は先頭と一致します。
              {loop.phaseErrorDeg > 5
                ? `搬送波の位相は継ぎ目で ${Math.round(loop.phaseErrorDeg)}° ずれるため、
                   わずかな段差が出ることがあります（Δf や搬送波を整数 Hz にすると揃います）。`
                : '搬送波の位相もほぼ揃います。'}
            </p>
          )}
        </li>

        <li className="card">
          <div className="row-between">
            <span>ファイルサイズ（見積）</span>
            <strong style={{ fontVariantNumeric: 'tabular-nums' }}>
              {formatBytes(estimatedBytes)}
            </strong>
          </div>
          {estimatedBytes > 500e6 && (
            <p className="faint" style={{ margin: '8px 0 0' }}>
              大きなファイルです。端末の空き容量を確認してください。
            </p>
          )}
        </li>

        {status === 'rendering' && (
          <li className="card">
            <div className="row-between">
              <span>{progress === 0 ? '合成の準備中…' : '書き出し中…'}</span>
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
                保存
              </a>
            </div>
          </li>
        )}

        <li className="card">
          <p className="faint" style={{ margin: 0 }}>
            音はこの端末の中だけで合成されます。書き出しの間もどこにも送信されません。
            再生と書き出しはまったく同じ合成コードを通るので、聴いた音がそのままファイルになります。
          </p>
        </li>
      </ul>

      <div className="start-row">
        {status === 'rendering' ? (
          <button className="btn btn-danger" onClick={() => abortRef.current?.abort()}>
            中断
          </button>
        ) : (
          <button className="btn btn-primary" onClick={() => void start()}>
            書き出す
          </button>
        )}
      </div>
    </>
  );
}
