import { useMemo, useState } from 'react';
import { getAudioDiagnostics, setVolume } from '../state/controller';
import { clearLog, summarize } from '../state/sessionLog';
import { useAppStore } from '../state/store';
import { formatClock } from './format';
import { SafetyNotice } from './SafetyNotice';

export function Settings() {
  const [showSafety, setShowSafety] = useState(false);
  const log = useAppStore((s) => s.log);
  const outputMode = useAppStore((s) => s.outputMode);
  const [diagnostics, setDiagnostics] = useState(getAudioDiagnostics);
  const refreshLog = useAppStore((s) => s.refreshLog);
  const summary = useMemo(() => summarize(log), [log]);
  const volume = useAppStore((s) => s.volume);
  const chimeEnabled = useAppStore((s) => s.chimeEnabled);
  const setChimeEnabled = useAppStore((s) => s.setChimeEnabled);
  const wakeLockEnabled = useAppStore((s) => s.wakeLockEnabled);
  const setWakeLockEnabled = useAppStore((s) => s.setWakeLockEnabled);
  const setView = useAppStore((s) => s.setView);

  return (
    <>
      {showSafety && <SafetyNotice mode="review" onAcknowledge={() => setShowSafety(false)} />}

      <div className="topbar">
        <h1 className="brand">設定</h1>
        <button className="btn btn-ghost" onClick={() => setView('home')}>
          戻る
        </button>
      </div>

      <ul className="list-plain">
        <li className="card">
          <div className="row">
            <span className="faint" style={{ minWidth: '4em' }}>
              音量
            </span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={volume}
              onChange={(e) => setVolume(Number(e.target.value))}
              aria-label="音量"
            />
            <span className="faint" style={{ minWidth: '3em', textAlign: 'right' }}>
              {Math.round(volume * 100)}%
            </span>
          </div>
          <p className="faint" style={{ margin: '8px 0 0' }}>
            出力は 0 dBFS を超えないよう保護リミッタが入っています。ブーストはしません。
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
              区切りのチャイム
              <span className="faint"> — セグメントの終わりに小さなベルを鳴らす</span>
            </span>
          </label>
        </li>

        <li className="card">
          <label className="switch">
            <input
              type="checkbox"
              checked={wakeLockEnabled}
              onChange={(e) => setWakeLockEnabled(e.target.checked)}
            />
            <span>
              再生中は画面を消さない
              <span className="faint"> — 電池を使うので、バックグラウンド再生が効くなら不要です</span>
            </span>
          </label>
          {outputMode !== 'unknown' && (
            <p className="faint" style={{ margin: '10px 0 0' }}>
              バックグラウンド維持:{' '}
              <b>{outputMode === 'keepalive' ? '有効' : '無効'}</b>
              {outputMode === 'keepalive'
                ? ' — 画面ロックやアプリ切り替えでも音が続くはずです'
                : ' — この環境ではバックグラウンド再生が止まります'}
            </p>
          )}
        </li>

        <li className="card">
          <div className="row-between">
            <span>動作状況</span>
            <button className="btn btn-ghost" onClick={() => setDiagnostics(getAudioDiagnostics())}>
              更新
            </button>
          </div>
          <p className="faint" style={{ margin: '6px 0 10px' }}>
            うまく動かないときの切り分け用です。そのまま伝えていただければ原因を追えます。
          </p>
          <dl className="diagnostics">
            <dt>ビルド</dt>
            <dd>{diagnostics.buildId}</dd>
            <dt>バックグラウンド維持</dt>
            <dd>
              {diagnostics.outputMode === 'keepalive'
                ? '有効'
                : diagnostics.outputMode === 'direct'
                  ? '無効'
                  : '未再生（一度再生すると判明します）'}
            </dd>
            {diagnostics.keepaliveError && (
              <>
                <dt>失敗理由</dt>
                <dd>{diagnostics.keepaliveError}</dd>
              </>
            )}
            <dt>キープアライブ</dt>
            <dd>
              {diagnostics.keepalivePaused === null
                ? '未作成'
                : diagnostics.keepalivePaused
                  ? '停止中'
                  : '再生中'}
            </dd>
            <dt>AudioContext</dt>
            <dd>
              {diagnostics.contextState ?? '未作成'}
              {diagnostics.sampleRate ? ` / ${diagnostics.sampleRate} Hz` : ''}
            </dd>
            <dt>MediaSession</dt>
            <dd>{diagnostics.mediaSessionSupported ? '対応' : '非対応'}</dd>
            <dt>Wake Lock</dt>
            <dd>{diagnostics.wakeLockSupported ? '対応' : '非対応'}</dd>
            <dt>Service Worker</dt>
            <dd>{diagnostics.serviceWorkerControlled ? '有効' : '未適用'}</dd>
            <dt>表示モード</dt>
            <dd>{diagnostics.standalone ? 'アプリとして起動' : 'ブラウザのタブ'}</dd>
          </dl>
        </li>

        <li className="card">
          <div className="row-between">
            <span>安全性の注意事項</span>
            <button className="btn" onClick={() => setShowSafety(true)}>
              表示する
            </button>
          </div>
        </li>

        <li className="card">
          <div className="row-between">
            <span>ヘッドホンチェック</span>
            <button className="btn" onClick={() => setView('headphone')}>
              やり直す
            </button>
          </div>
        </li>

        <li className="card">
          <div className="row-between">
            <span>記録</span>
            {log.length > 0 && (
              <button
                className="btn btn-ghost"
                onClick={() => {
                  clearLog();
                  refreshLog();
                }}
              >
                すべて消す
              </button>
            )}
          </div>
          {log.length === 0 ? (
            <p className="faint" style={{ margin: '8px 0 0' }}>
              まだ記録がありません。
            </p>
          ) : (
            <>
              <div className="spec-row" style={{ marginTop: 10 }}>
                <span>
                  連続 <b>{summary.streakDays} 日</b>
                </span>
                <span>
                  今週 <b>{Math.round(summary.lastWeekSec / 60)} 分</b>
                </span>
                <span>
                  通算 <b>{Math.round(summary.totalSec / 3600)} 時間</b>
                </span>
                <span>
                  完走 <b>{summary.completedCount}</b> / {summary.sessionCount}
                </span>
              </div>
              <ul className="list-plain" style={{ marginTop: 12, gap: 6 }}>
                {[...log]
                  .reverse()
                  .slice(0, 8)
                  .map((entry, index) => (
                    <li key={index} className="row-between faint" style={{ fontSize: 12.5 }}>
                      <span>
                        {new Date(entry.startedAt).toLocaleString('ja-JP', {
                          month: 'numeric',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}{' '}
                        {entry.presetName}
                      </span>
                      <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                        {formatClock(entry.completedSec)}
                        {entry.completed ? '' : ' 中断'}
                      </span>
                    </li>
                  ))}
              </ul>
            </>
          )}
        </li>

        <li className="card">
          <p className="faint" style={{ margin: 0 }}>
            音はすべてこのアプリ内で合成しており、音源ファイルも通信も使いません。設定・マイプリセット・記録は
            この端末の localStorage にのみ保存され、外部に送信されることはありません。
          </p>
        </li>
      </ul>
    </>
  );
}
