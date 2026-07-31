/**
 * セッション画面（SPEC.md §7.1-2）。情報を削ぎ落とし、残り時間と現在の状態だけを見せる。
 */

import { BAND_LABELS, bandForBeatHz } from '../audio/carrier';
import { skipSegment, stopSession, togglePause } from '../state/controller';
import { useAppStore } from '../state/store';
import { findPreset } from '../presets/sessions';
import { formatClock, formatHz, PHASE_LABELS, SEGMENT_LABELS } from './format';
import { ProgressRing } from './ProgressRing';

export function SessionView() {
  const runtime = useAppStore((s) => s.runtime);
  const dimmed = useAppStore((s) => s.dimmed);
  const setDimmed = useAppStore((s) => s.setDimmed);
  const presetId = useAppStore((s) => s.presetId);
  const substitutions = useAppStore((s) => s.substitutions);
  const setView = useAppStore((s) => s.setView);
  const resetRuntime = useAppStore((s) => s.resetRuntime);

  const preset = findPreset(presetId);
  const band = BAND_LABELS[bandForBeatHz(runtime.beatHz)];
  const multiSegment = runtime.segmentCount > 1;

  if (dimmed) {
    return (
      <button className="dim-overlay" onClick={() => setDimmed(false)} aria-label="暗転を解除">
        <div className="clock">{formatClock(runtime.remainingSec)}</div>
        <div className="clock-sub">タップで戻る</div>
      </button>
    );
  }

  if (runtime.status === 'completed') {
    return (
      <div className="session">
        <h2 style={{ margin: 0, fontWeight: 400 }}>おつかれさまでした</h2>
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
            ホームに戻る
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
            ? `${SEGMENT_LABELS[runtime.segmentKind]} · あと ${formatClock(runtime.segmentRemainingSec)}`
            : preset?.name}
        </div>
      </ProgressRing>

      <div>
        <div className="beat-readout">
          <span className="beat-hz">{formatHz(runtime.beatHz, 2)}</span>
          <span className="muted">{band}</span>
        </div>
        <p className="faint" style={{ margin: '4px 0 0' }}>
          {PHASE_LABELS[runtime.phase]}
          {multiSegment && ` · ${runtime.segmentIndex + 1} / ${runtime.segmentCount}`}
          {runtime.carrierHz > 0 && ` · 搬送波 ${runtime.carrierHz} Hz`}
        </p>
      </div>

      {substitutions.length > 0 && (
        <p className="faint" style={{ margin: 0, maxWidth: '32em' }}>
          一部の環境音はまだ実装前のため、近い質感のノイズで代替しています。
        </p>
      )}

      <div className="controls">
        <button className="btn" onClick={() => void togglePause()}>
          {runtime.status === 'paused' ? '再開' : '一時停止'}
        </button>
        {multiSegment && (
          <button className="btn" onClick={skipSegment}>
            次のセグメントへ
          </button>
        )}
        <button className="btn" onClick={() => setDimmed(true)}>
          暗転
        </button>
        <button className="btn btn-danger" onClick={() => void stopSession()}>
          終了
        </button>
      </div>

      <p className="faint" style={{ margin: 0 }}>
        Space 一時停止 / D 暗転 / N スキップ / Esc 終了
      </p>
    </div>
  );
}
