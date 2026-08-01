/**
 * Home 画面（SPEC.md §7.1-1）。プリセット選択と開始。
 *
 * 選んだプリセットの説明は、**その一覧の直下**に出す。
 * 一覧をすべて並べたあとにまとめて置くと、上の方のボタンを押したときに
 * 説明が画面のずっと下にあって気づけない（実際に指摘を受けた）。
 */

import { beatHzAt, curveDurationSec } from '../audio/BeatCurve';
import { bandForBeatHz } from '../audio/carrier';
import type { AmbienceId, BeatCurve, SessionPreset } from '../audio/types';
import type { Translate } from '../i18n';
import { setVolume, startSession } from '../state/controller';
import { createDraftFrom } from '../state/myPresets';
import { useAppStore } from '../state/store';
import { BUILT_IN_PRESETS, DEFAULT_PRESET_ID, findPreset } from '../presets/sessions';
import { ambienceLabel, bandLabel, formatHz, formatMinutes, modeLabel } from './format';
import { useT } from './useT';

/** カーブの要点を「10.0 → 16.0 → 12.0 Hz」の形にまとめる */
function describeCurve(curve: BeatCurve, t: Translate): string {
  const waypoints: number[] = [];
  for (const p of curve.points) {
    const last = waypoints[waypoints.length - 1];
    if (last === undefined || Math.abs(last - p.hz) > 0.01) waypoints.push(p.hz);
  }
  if (waypoints.length <= 1) {
    return t('home.fixed', { hz: formatHz(beatHzAt(curve, 0), 2) });
  }
  const shown =
    waypoints.length > 4
      ? [waypoints[0]!, waypoints[1]!, waypoints[waypoints.length - 1]!]
      : waypoints;
  return `${shown.map((hz) => hz.toFixed(1)).join(' → ')} Hz`;
}

function totalDurationSec(preset: SessionPreset): number {
  return preset.segments.reduce((sum, s) => sum + s.durationSec, 0);
}

/** 組み込みプリセットの説明は翻訳から引く。マイプリセットは保存された文字列をそのまま使う。 */
function presetDescription(preset: SessionPreset, t: Translate): string {
  if (!preset.builtIn) return preset.description;
  const translated = t(`preset.${preset.id}` as never);
  return translated.startsWith('preset.') ? preset.description : translated;
}

function PresetButton({
  preset,
  selected,
  onSelect,
  t,
}: {
  preset: SessionPreset;
  selected: boolean;
  onSelect(): void;
  t: Translate;
}) {
  const first = preset.segments[0]!;
  const hz = beatHzAt(first.beat.curve, curveDurationSec(first.beat.curve) / 2);
  return (
    <button
      className="preset"
      aria-pressed={selected}
      onClick={onSelect}
      data-colorway={preset.colorway}
    >
      <span className="preset-name">{preset.name}</span>
      <span className="preset-meta">
        {bandLabel(bandForBeatHz(hz), t)} · {formatMinutes(totalDurationSec(preset), t)}
      </span>
    </button>
  );
}

export function Home() {
  const t = useT();
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
    draft ??
    findPreset(presetId) ??
    myPresets.find((p) => p.id === presetId) ??
    BUILT_IN_PRESETS[0]!;
  const first = preset.segments[0]!;
  const focusPresets = BUILT_IN_PRESETS.filter((p) => p.category === 'focus');
  const meditatePresets = BUILT_IN_PRESETS.filter((p) => p.category === 'meditate');

  const ambienceIds = Object.entries(first.ambience.layers)
    .filter(([, level]) => (level ?? 0) > 0)
    .map(([id]) => id as AmbienceId);

  const sessionMinutes = pomodoro
    ? Math.round((first.durationSec * cycles + 5 * 60 * (cycles - 1) + 20 * 60) / 60)
    : Math.round(totalDurationSec(preset) / 60);

  /** 選択中のプリセットがどの一覧に属するか。説明をその直下に出すために使う。 */
  const selectedGroup: 'focus' | 'meditate' | 'mine' = focusPresets.some((p) => p.id === preset.id)
    ? 'focus'
    : meditatePresets.some((p) => p.id === preset.id)
      ? 'meditate'
      : 'mine';

  const detail = (
    <div className="card detail-card">
      <div className="row-between">
        <strong>
          {preset.name}
          {draft && <span className="faint">{t('home.editing')}</span>}
        </strong>
        <span className="faint">{formatMinutes(sessionMinutes * 60, t)}</span>
      </div>
      <p className="muted" style={{ margin: '6px 0 12px', fontSize: 13.5 }}>
        {presetDescription(preset, t)}
      </p>
      <div className="spec-row">
        <span>
          {t('home.beat')} <b>{describeCurve(first.beat.curve, t)}</b>
        </span>
        <span>
          {t('home.carrier')} <b>{first.beat.carrierHz} Hz</b>
        </span>
        <span>
          {t('home.mode')} <b>{modeLabel(first.beat.mode, t)}</b>
        </span>
      </div>
      <div className="chips" style={{ marginTop: 10 }}>
        {ambienceIds.length === 0 && <span className="chip">{t('home.pureToneOnly')}</span>}
        {ambienceIds.map((id) => (
          <span className="chip" key={id}>
            {ambienceLabel(id, t)}
          </span>
        ))}
      </div>
    </div>
  );

  return (
    <>
      <div className="topbar">
        <h1 className="brand">
          Binaural Studio <span>/ {t('home.tagline')}</span>
        </h1>
        <div className="icon-row">
          <button className="btn btn-ghost" onClick={() => setView('headphone')}>
            {t('common.headphoneCheck')}
          </button>
          <button className="btn btn-ghost" onClick={() => setView('settings')}>
            {t('common.settings')}
          </button>
        </div>
      </div>

      {!headphoneChecked && (
        <div className="notice">
          <span>{t('home.headphoneBanner')}</span>
          <button
            className="btn"
            onClick={() => setView('headphone')}
            style={{ flexShrink: 0 }}
          >
            {t('home.headphoneBannerAction')}
          </button>
        </div>
      )}

      {error && <div className="error">{error}</div>}

      <p className="section-label">{t('home.focus')}</p>
      <div className="preset-grid">
        {focusPresets.map((p) => (
          <PresetButton
            key={p.id}
            preset={p}
            selected={p.id === preset.id}
            onSelect={() => selectPreset(p.id)}
            t={t}
          />
        ))}
      </div>
      {selectedGroup === 'focus' && detail}

      <p className="section-label">{t('home.meditate')}</p>
      <div className="preset-grid">
        {meditatePresets.map((p) => (
          <PresetButton
            key={p.id}
            preset={p}
            selected={p.id === preset.id}
            onSelect={() => selectPreset(p.id)}
            t={t}
          />
        ))}
      </div>
      {selectedGroup === 'meditate' && detail}

      {myPresets.length > 0 && (
        <>
          <p className="section-label">{t('home.myPresets')}</p>
          <div className="preset-grid">
            {myPresets.map((p) => (
              <PresetButton
                key={p.id}
                preset={p}
                selected={p.id === preset.id}
                onSelect={() => setDraft(p)}
                t={t}
              />
            ))}
          </div>
        </>
      )}
      {selectedGroup === 'mine' && detail}

      <div className="detail">
        <div className="card">
          <label className="switch">
            <input
              type="checkbox"
              checked={pomodoro}
              onChange={(e) => setPomodoro(e.target.checked)}
            />
            <span>
              {t('home.pomodoro')}
              <span className="faint"> — {t('home.pomodoroHint')}</span>
            </span>
          </label>
          {pomodoro && (
            <div className="row" style={{ marginTop: 12 }}>
              <span className="faint">{t('home.cycles')}</span>
              <input
                type="range"
                min={2}
                max={8}
                step={1}
                value={cycles}
                onChange={(e) => setCycles(Number(e.target.value))}
                aria-label={t('home.cycles')}
              />
              <span className="faint" style={{ minWidth: '2.5em', textAlign: 'right' }}>
                {t('home.cyclesUnit', { n: cycles })}
              </span>
            </div>
          )}
        </div>

        <div className="card">
          <div className="row">
            <span className="faint" style={{ minWidth: '3em' }}>
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
          {volume > 0.75 && (
            <p className="faint" style={{ margin: '8px 0 0' }}>
              {t('home.volumeWarning')}
            </p>
          )}
        </div>
      </div>

      <div className="start-row">
        <button className="btn btn-primary" onClick={() => void startSession()}>
          {t('home.start', { n: sessionMinutes })}
        </button>
        <div className="controls">
          <button
            className="btn"
            onClick={() => {
              setDraft(draft ?? createDraftFrom(preset));
              setView('studio');
            }}
          >
            {draft ? t('home.editInStudio') : t('home.duplicateAndEdit')}
          </button>
          <button className="btn" onClick={() => setView('export')}>
            {t('home.exportWav')}
          </button>
          {draft && (
            <button
              className="btn btn-ghost"
              onClick={() => {
                setDraft(null);
                selectPreset(DEFAULT_PRESET_ID);
              }}
            >
              {t('home.backToBuiltIn')}
            </button>
          )}
        </div>
        <p className="faint" style={{ margin: 0 }}>
          {t('home.spaceHint')}
        </p>
      </div>
    </>
  );
}
