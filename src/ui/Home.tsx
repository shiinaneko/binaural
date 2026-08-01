/**
 * Home 画面（SPEC.md §7.1-1）。プリセット選択と開始。
 *
 * 一覧はタブで切り替え、**一度に 1 つだけ**表示する。説明カードは常に一覧の直下、
 * 同じ位置に出る。すべての一覧を縦に並べると、上の方のボタンを押したときに
 * 説明が画面のずっと下に来てしまい、選ぶたびに視線が大きく動く（実際に指摘を受けた）。
 * 一覧の高さは最小値を確保してあるので、タブを変えても説明の位置がずれない。
 */

import { useRef, useState } from 'react';
import { beatHzAt, curveDurationSec } from '../audio/BeatCurve';
import { bandForBeatHz } from '../audio/carrier';
import type { AmbienceId, BeatCurve, SessionPreset } from '../audio/types';
import type { Translate } from '../i18n';
import { setVolume, startSession } from '../state/controller';
import { createDraftFrom } from '../state/myPresets';
import { useAppStore } from '../state/store';
import { BUILT_IN_PRESETS, DEFAULT_PRESET_ID, findPreset } from '../presets/sessions';
import { ambienceLabel, bandLabel, formatHz, formatMinutes, modeLabel } from './format';
import { GearIcon, HeadphonesIcon } from './icons';
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

type TabId = 'focus' | 'meditate' | 'mine';

/** マイプリセットを選ぶときは下書きとして開く（そのまま編集に進めるように） */
const entryIsMine = (id: TabId): boolean => id === 'mine';

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

  /** 選択中のプリセットがどの一覧に属するか */
  const selectedGroup: TabId = focusPresets.some((p) => p.id === preset.id)
    ? 'focus'
    : meditatePresets.some((p) => p.id === preset.id)
      ? 'meditate'
      : 'mine';

  const tabs: Array<{ id: TabId; label: string; presets: SessionPreset[] }> = [
    { id: 'focus', label: t('home.focus'), presets: focusPresets },
    { id: 'meditate', label: t('home.meditate'), presets: meditatePresets },
    ...(myPresets.length > 0
      ? [{ id: 'mine' as const, label: t('home.myPresets'), presets: myPresets }]
      : []),
  ];

  // 開いたときは、選ばれているプリセットの一覧を出す
  const [tab, setTab] = useState<TabId>(selectedGroup);
  const activeTab = tabs.find((entry) => entry.id === tab) ?? tabs[0]!;

  /**
   * 横スワイプでもタブを移せるようにする。
   * 縦スクロールを邪魔しないよう、横の移動が明確に優勢なときだけ反応させる。
   */
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    const point = e.touches[0];
    if (point) touchStart.current = { x: point.clientX, y: point.clientY };
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const start = touchStart.current;
    const point = e.changedTouches[0];
    touchStart.current = null;
    if (!start || !point) return;
    const dx = point.clientX - start.x;
    const dy = point.clientY - start.y;
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    const index = tabs.findIndex((entry) => entry.id === activeTab.id);
    const next = tabs[dx < 0 ? index + 1 : index - 1];
    if (next) setTab(next.id);
  };

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
        {/* アイコンだけにするので、意味は aria-label と title で伝える */}
        <div className="icon-row">
          <button
            className="btn btn-icon"
            onClick={() => setView('headphone')}
            aria-label={t('common.headphoneCheck')}
            title={t('common.headphoneCheck')}
          >
            <HeadphonesIcon />
          </button>
          <button
            className="btn btn-icon"
            onClick={() => setView('settings')}
            aria-label={t('common.settings')}
            title={t('common.settings')}
          >
            <GearIcon />
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

      <div className="tabs" role="tablist">
        {tabs.map((entry) => (
          <button
            key={entry.id}
            role="tab"
            className="tab"
            aria-selected={entry.id === activeTab.id}
            onClick={() => setTab(entry.id)}
          >
            {entry.label}
            {/* 選択中のプリセットが別のタブにあるとき、どこにあるかを示す */}
            {entry.id === selectedGroup && entry.id !== activeTab.id && (
              <span className="tab-dot" aria-hidden="true" />
            )}
          </button>
        ))}
      </div>

      <div className="tab-panel" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        <div className="preset-grid">
          {activeTab.presets.map((p) => (
            <PresetButton
              key={p.id}
              preset={p}
              selected={p.id === preset.id}
              onSelect={() => (entryIsMine(activeTab.id) ? setDraft(p) : selectPreset(p.id))}
              t={t}
            />
          ))}
        </div>
        {detail}
      </div>

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
