/**
 * Home 画面（SPEC.md §7.1-1）。プリセット選択と開始。
 */

import { beatHzAt, curveDurationSec } from '../audio/BeatCurve';
import { BAND_LABELS, bandForBeatHz } from '../audio/carrier';
import { AMBIENCE_LABELS } from '../audio/layers';
import { isImplemented } from '../audio/layers/fallback';
import type { AmbienceId, BeatCurve, SessionPreset } from '../audio/types';
import { setVolume, startSession } from '../state/controller';
import { createDraftFrom } from '../state/myPresets';
import { useAppStore } from '../state/store';
import { BUILT_IN_PRESETS, DEFAULT_PRESET_ID, findPreset } from '../presets/sessions';
import { formatHz, formatMinutes, MODE_LABELS } from './format';

/** カーブの要点を「10.0 → 16.0 → 12.0 Hz」の形にまとめる */
function describeCurve(curve: BeatCurve): string {
  const waypoints: number[] = [];
  for (const p of curve.points) {
    const last = waypoints[waypoints.length - 1];
    if (last === undefined || Math.abs(last - p.hz) > 0.01) waypoints.push(p.hz);
  }
  if (waypoints.length <= 1) {
    return `${formatHz(beatHzAt(curve, 0), 2)} 固定`;
  }
  const shown = waypoints.length > 4 ? [waypoints[0]!, waypoints[1]!, waypoints[waypoints.length - 1]!] : waypoints;
  return `${shown.map((hz) => hz.toFixed(1)).join(' → ')} Hz`;
}

function totalDurationSec(preset: SessionPreset): number {
  return preset.segments.reduce((sum, s) => sum + s.durationSec, 0);
}

function PresetButton({ preset, selected, onSelect }: {
  preset: SessionPreset;
  selected: boolean;
  onSelect(): void;
}) {
  const first = preset.segments[0]!;
  const hz = beatHzAt(first.beat.curve, curveDurationSec(first.beat.curve) / 2);
  return (
    <button className="preset" aria-pressed={selected} onClick={onSelect} data-colorway={preset.colorway}>
      <span className="preset-name">{preset.name}</span>
      <span className="preset-meta">
        {BAND_LABELS[bandForBeatHz(hz)]} · {formatMinutes(totalDurationSec(preset))}
      </span>
    </button>
  );
}

export function Home() {
  const presetId = useAppStore((s) => s.presetId);
  const selectPreset = useAppStore((s) => s.selectPreset);
  const pomodoro = useAppStore((s) => s.pomodoro);
  const setPomodoro = useAppStore((s) => s.setPomodoro);
  const cycles = useAppStore((s) => s.cycles);
  const setCycles = useAppStore((s) => s.setCycles);
  const volume = useAppStore((s) => s.volume);
  const headphoneChecked = useAppStore((s) => s.headphoneChecked);
  const setView = useAppStore((s) => s.setView);
  const error = useAppStore((s) => s.error);

  const draft = useAppStore((s) => s.draft);
  const setDraft = useAppStore((s) => s.setDraft);
  const myPresets = useAppStore((s) => s.myPresets);

  const preset =
    draft ?? findPreset(presetId) ?? myPresets.find((p) => p.id === presetId) ?? BUILT_IN_PRESETS[0]!;
  const first = preset.segments[0]!;
  const focusPresets = BUILT_IN_PRESETS.filter((p) => p.category === 'focus');
  const meditatePresets = BUILT_IN_PRESETS.filter((p) => p.category === 'meditate');

  const ambienceIds = Object.entries(first.ambience.layers)
    .filter(([, level]) => (level ?? 0) > 0)
    .map(([id]) => id as AmbienceId);
  const pending = ambienceIds.filter((id) => !isImplemented(id));

  const sessionMinutes = pomodoro
    ? Math.round((first.durationSec * cycles + 5 * 60 * (cycles - 1) + 20 * 60) / 60)
    : Math.round(totalDurationSec(preset) / 60);

  return (
    <>
      <div className="topbar">
        <h1 className="brand">
          Binaural Studio <span>/ 集中と瞑想のための音</span>
        </h1>
        <div className="icon-row">
          <button className="btn btn-ghost" onClick={() => setView('headphone')}>
            ヘッドホン確認
          </button>
          <button className="btn btn-ghost" onClick={() => setView('settings')}>
            設定
          </button>
        </div>
      </div>

      {!headphoneChecked && (
        <div className="notice">
          <span>
            ヘッドホンでの再生が前提の音です。左右の向きとうなりの聞こえ方を先に確認しておくと、
            以降の体験が安定します。
          </span>
          <button className="btn" onClick={() => setView('headphone')} style={{ flexShrink: 0 }}>
            確認する
          </button>
        </div>
      )}

      {error && <div className="error">{error}</div>}

      <p className="section-label">集中</p>
      <div className="preset-grid">
        {focusPresets.map((p) => (
          <PresetButton key={p.id} preset={p} selected={p.id === presetId} onSelect={() => selectPreset(p.id)} />
        ))}
      </div>

      <p className="section-label">瞑想・リラックス</p>
      <div className="preset-grid">
        {meditatePresets.map((p) => (
          <PresetButton key={p.id} preset={p} selected={p.id === presetId} onSelect={() => selectPreset(p.id)} />
        ))}
      </div>

      {myPresets.length > 0 && (
        <>
          <p className="section-label">マイプリセット</p>
          <div className="preset-grid">
            {myPresets.map((p) => (
              <PresetButton
                key={p.id}
                preset={p}
                selected={p.id === preset.id}
                onSelect={() => setDraft(p)}
              />
            ))}
          </div>
        </>
      )}

      <div className="detail">
        <div className="card">
          <div className="row-between">
            <strong>
              {preset.name}
              {draft && <span className="faint"> ・編集中</span>}
            </strong>
            <span className="faint">{sessionMinutes} 分</span>
          </div>
          <p className="muted" style={{ margin: '6px 0 12px', fontSize: 13.5 }}>
            {preset.description}
          </p>
          <div className="spec-row">
            <span>
              ビート <b>{describeCurve(first.beat.curve)}</b>
            </span>
            <span>
              搬送波 <b>{first.beat.carrierHz} Hz</b>
            </span>
            <span>
              方式 <b>{MODE_LABELS[first.beat.mode]}</b>
            </span>
          </div>
          <div className="chips" style={{ marginTop: 10 }}>
            {ambienceIds.length === 0 && <span className="chip">純音のみ</span>}
            {ambienceIds.map((id) => (
              <span className="chip" key={id}>
                {AMBIENCE_LABELS[id]}
                {!isImplemented(id) && ' (代替中)'}
              </span>
            ))}
          </div>
          {pending.length > 0 && (
            <p className="faint" style={{ marginBottom: 0 }}>
              {pending.map((id) => AMBIENCE_LABELS[id]).join('・')}
              はまだ実装前のため、近い質感のノイズで代替して再生します。
            </p>
          )}
        </div>

        <div className="card">
          <label className="switch">
            <input type="checkbox" checked={pomodoro} onChange={(e) => setPomodoro(e.target.checked)} />
            <span>
              ポモドーロで通す
              <span className="faint"> — 休憩を挟んで繰り返す（音は途切れません）</span>
            </span>
          </label>
          {pomodoro && (
            <div className="row" style={{ marginTop: 12 }}>
              <span className="faint">サイクル数</span>
              <input
                type="range"
                min={2}
                max={8}
                step={1}
                value={cycles}
                onChange={(e) => setCycles(Number(e.target.value))}
                aria-label="サイクル数"
              />
              <span className="faint" style={{ minWidth: '2.5em', textAlign: 'right' }}>
                {cycles} 本
              </span>
            </div>
          )}
        </div>

        <div className="card">
          <div className="row">
            <span className="faint" style={{ minWidth: '3em' }}>
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
          {volume > 0.75 && (
            <p className="faint" style={{ margin: '8px 0 0' }}>
              聴覚保護のため、最大音量の 60% 以下をおすすめします。
            </p>
          )}
        </div>
      </div>

      <div className="start-row">
        <button className="btn btn-primary" onClick={() => void startSession()}>
          {sessionMinutes} 分で開始
        </button>
        <div className="controls">
          <button
            className="btn"
            onClick={() => {
              setDraft(draft ?? createDraftFrom(preset));
              setView('studio');
            }}
          >
            {draft ? 'Studio で編集' : '複製して編集'}
          </button>
          <button className="btn" onClick={() => setView('export')}>
            WAV で書き出す
          </button>
          {draft && (
            <button
              className="btn btn-ghost"
              onClick={() => {
                setDraft(null);
                selectPreset(DEFAULT_PRESET_ID);
              }}
            >
              組み込みに戻す
            </button>
          )}
        </div>
        <p className="faint" style={{ margin: 0 }}>
          Space で開始 / 一時停止
        </p>
      </div>
    </>
  );
}
