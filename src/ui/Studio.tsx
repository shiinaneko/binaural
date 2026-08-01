/**
 * Studio 編集画面（SPEC.md §7.1-3）。
 * 編集対象は下書き（draft）で、Home / 書き出し / 再生はすべてこの下書きを使う。
 */

import { useState } from 'react';
import { curveDurationSec } from '../audio/BeatCurve';
import { isValidPair, minCarrierForBeat } from '../audio/carrier';
import { IMPLEMENTED_AMBIENCES } from '../audio/layers';
import {
  BEAT_MAX_HZ,
  CARRIER_MAX_HZ,
  CARRIER_MIN_HZ,
  MAX_RATE_HZ_PER_MIN,
  type BeatMode,
  type SessionPreset,
} from '../audio/types';
import { startSession } from '../state/controller';
import {
  deleteMyPreset,
  exportPresetJson,
  importPresetJson,
  PresetImportError,
  saveMyPreset,
} from '../state/myPresets';
import { useAppStore } from '../state/store';
import { CurveEditor } from './CurveEditor';
import { ambienceLabel, formatHz, modeLabel } from './format';
import { useT } from './useT';

const MODES: BeatMode[] = ['binaural', 'monaural', 'isochronic', 'hybrid'];

export function Studio() {
  const t = useT();
  const draft = useAppStore((s) => s.draft);
  const setDraft = useAppStore((s) => s.setDraft);
  const setView = useAppStore((s) => s.setView);
  const refreshMyPresets = useAppStore((s) => s.refreshMyPresets);
  const [message, setMessage] = useState<string | null>(null);
  const [importText, setImportText] = useState('');
  const [showJson, setShowJson] = useState(false);

  if (!draft) {
    return (
      <>
        <div className="topbar">
          <h1 className="brand">{t('studio.title')}</h1>
          <button className="btn btn-ghost" onClick={() => setView('home')}>
            {t('common.back')}
          </button>
        </div>
        <div className="card">
          <p className="muted" style={{ margin: 0 }}>
            {t('studio.empty')}
          </p>
        </div>
      </>
    );
  }

  const segment = draft.segments[0]!;
  const durationSec = segment.durationSec;
  const rateLimit =
    draft.category === 'meditate' ? MAX_RATE_HZ_PER_MIN.meditate : MAX_RATE_HZ_PER_MIN.focus;

  const update = (mutate: (next: SessionPreset) => void) => {
    const next = structuredClone(draft);
    mutate(next);
    setDraft(next);
  };

  const maxBeatHz = segment.beat.curve.points.reduce((max, p) => Math.max(max, p.hz), 0);
  const minCarrier = Math.ceil(minCarrierForBeat(maxBeatHz));
  const carrierValid = isValidPair(segment.beat.carrierHz, maxBeatHz);

  const setDuration = (minutes: number) => {
    const nextDuration = Math.round(minutes) * 60;
    update((next) => {
      const target = next.segments[0]!;
      const scale = nextDuration / target.durationSec;
      target.durationSec = nextDuration;
      // カーブは相対位置を保ったまま伸縮する
      target.beat.curve = {
        ...target.beat.curve,
        points: target.beat.curve.points.map((p) => ({ ...p, t: p.t * scale })),
      };
      target.fadeInSec = Math.min(target.fadeInSec, nextDuration / 4);
      target.fadeOutSec = Math.min(target.fadeOutSec, nextDuration / 4);
    });
  };

  const save = () => {
    saveMyPreset(draft);
    refreshMyPresets();
    setMessage(t('studio.saved'));
  };

  const remove = () => {
    deleteMyPreset(draft.id);
    refreshMyPresets();
    setDraft(null);
    setView('home');
  };

  const doImport = () => {
    try {
      const imported = importPresetJson(importText);
      setDraft(imported);
      setImportText('');
      setMessage(t('studio.imported', { name: imported.name }));
    } catch (err) {
      setMessage(err instanceof PresetImportError ? err.message : t('studio.importFailed'));
    }
  };

  const modeHint: Record<BeatMode, string> = {
    binaural: t('studio.modeBinaural'),
    monaural: t('studio.modeMonaural'),
    isochronic: t('studio.modeIsochronic'),
    hybrid: t('studio.modeHybrid'),
  };

  return (
    <>
      <div className="topbar">
        <h1 className="brand">
          {t('studio.title')} <span>/ {draft.name}</span>
        </h1>
        <div className="icon-row">
          <button className="btn btn-ghost" onClick={() => void startSession()}>
            {t('studio.preview')}
          </button>
          <button className="btn btn-ghost" onClick={() => setView('home')}>
            {t('common.back')}
          </button>
        </div>
      </div>

      {message && (
        <div className="notice" style={{ marginBottom: 14 }}>
          <span>{message}</span>
          <button className="btn btn-ghost" onClick={() => setMessage(null)}>
            {t('common.close')}
          </button>
        </div>
      )}

      <ul className="list-plain">
        <li className="card">
          <label className="field">
            <span className="faint">{t('studio.name')}</span>
            <input
              type="text"
              value={draft.name}
              maxLength={60}
              onChange={(e) => update((next) => void (next.name = e.target.value))}
            />
          </label>
          <div className="row" style={{ marginTop: 12 }}>
            <span className="faint" style={{ minWidth: '5em' }}>
              {t('studio.length')}
            </span>
            <input
              type="range"
              min={5}
              max={60}
              step={5}
              value={Math.round(durationSec / 60)}
              onChange={(e) => setDuration(Number(e.target.value))}
            />
            <span className="faint" style={{ minWidth: '4em', textAlign: 'right' }}>
              {t('common.minutes', { n: Math.round(durationSec / 60) })}
            </span>
          </div>
        </li>

        <li className="card">
          <p className="section-label" style={{ margin: '0 0 10px' }}>
            {t('studio.beat')}
          </p>
          <CurveEditor
            curve={segment.beat.curve}
            durationSec={durationSec}
            maxRateHzPerMin={rateLimit}
            onChange={(curve) =>
              update((next) => {
                const target = next.segments[0]!;
                const points = curve.points.map((p) => ({ ...p }));
                points[0]!.t = 0;
                points[points.length - 1]!.t = target.durationSec;
                target.beat.curve = { ...curve, points };
              })
            }
          />
          <div className="row" style={{ marginTop: 14 }}>
            <span className="faint" style={{ minWidth: '5em' }}>
              {t('studio.interpolation')}
            </span>
            <div className="chips">
              {(['smooth', 'linear'] as const).map((kind) => (
                <button
                  key={kind}
                  className="btn"
                  aria-pressed={segment.beat.curve.interpolation === kind}
                  style={
                    segment.beat.curve.interpolation === kind
                      ? { borderColor: 'var(--accent)', color: 'var(--accent)' }
                      : undefined
                  }
                  onClick={() =>
                    update((next) => void (next.segments[0]!.beat.curve.interpolation = kind))
                  }
                >
                  {kind === 'smooth' ? t('studio.smooth') : t('studio.linear')}
                </button>
              ))}
            </div>
          </div>
        </li>

        <li className="card">
          <p className="section-label" style={{ margin: '0 0 10px' }}>
            {t('studio.carrier')}
          </p>
          <div className="row">
            <span className="faint" style={{ minWidth: '5em' }}>
              {t('studio.frequency')}
            </span>
            <input
              type="range"
              min={CARRIER_MIN_HZ}
              max={CARRIER_MAX_HZ}
              step={5}
              value={segment.beat.carrierHz}
              onChange={(e) =>
                update((next) => void (next.segments[0]!.beat.carrierHz = Number(e.target.value)))
              }
            />
            <span className="faint" style={{ minWidth: '5em', textAlign: 'right' }}>
              {segment.beat.carrierHz} Hz
            </span>
          </div>
          <p className="faint" style={{ margin: '8px 0 0' }}>
            {t('studio.sides', {
              left: formatHz(segment.beat.carrierHz - maxBeatHz / 2, 1),
              right: formatHz(segment.beat.carrierHz + maxBeatHz / 2, 1),
            })}
            {!carrierValid && (
              <strong style={{ color: 'var(--danger)' }}>
                {' '}
                {t('studio.carrierTooLow', { hz: minCarrier })}
              </strong>
            )}
          </p>

          <div className="row" style={{ marginTop: 14 }}>
            <span className="faint" style={{ minWidth: '5em' }}>
              {t('studio.mode')}
            </span>
            <div className="chips">
              {MODES.map((mode) => (
                <button
                  key={mode}
                  className="btn"
                  aria-pressed={segment.beat.mode === mode}
                  style={
                    segment.beat.mode === mode
                      ? { borderColor: 'var(--accent)', color: 'var(--accent)' }
                      : undefined
                  }
                  onClick={() =>
                    update((next) => {
                      const target = next.segments[0]!;
                      target.beat.mode = mode;
                      if (
                        (mode === 'isochronic' || mode === 'hybrid') &&
                        target.beat.amDepth === 0
                      ) {
                        target.beat.amDepth = mode === 'isochronic' ? 0.85 : 0.15;
                      }
                    })
                  }
                >
                  {modeLabel(mode, t)}
                </button>
              ))}
            </div>
          </div>
          <p className="faint" style={{ margin: '8px 0 0' }}>
            {modeHint[segment.beat.mode]}
          </p>

          {(segment.beat.mode === 'isochronic' || segment.beat.mode === 'hybrid') && (
            <div className="row" style={{ marginTop: 12 }}>
              <span className="faint" style={{ minWidth: '5em' }}>
                {t('studio.amDepth')}
              </span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={segment.beat.amDepth}
                onChange={(e) =>
                  update((next) => void (next.segments[0]!.beat.amDepth = Number(e.target.value)))
                }
              />
              <span className="faint" style={{ minWidth: '4em', textAlign: 'right' }}>
                {Math.round(segment.beat.amDepth * 100)}%
              </span>
            </div>
          )}
        </li>

        <li className="card">
          <p className="section-label" style={{ margin: '0 0 10px' }}>
            {t('studio.ambience')}
          </p>
          {IMPLEMENTED_AMBIENCES.filter((id) => id !== 'none').map((id) => (
            <div className="row" key={id} style={{ marginBottom: 8 }}>
              <span className="faint" style={{ minWidth: '9em' }}>
                {ambienceLabel(id, t)}
              </span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={segment.ambience.layers[id] ?? 0}
                onChange={(e) =>
                  update((next) => {
                    const level = Number(e.target.value);
                    const layers = next.segments[0]!.ambience.layers;
                    if (level <= 0) delete layers[id];
                    else layers[id] = level;
                  })
                }
              />
              <span className="faint" style={{ minWidth: '3em', textAlign: 'right' }}>
                {Math.round((segment.ambience.layers[id] ?? 0) * 100)}
              </span>
            </div>
          ))}

          <div className="row" style={{ marginTop: 12 }}>
            <span className="faint" style={{ minWidth: '9em' }}>
              {t('studio.reverb')}
            </span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={segment.ambience.reverb}
              onChange={(e) =>
                update((next) => void (next.segments[0]!.ambience.reverb = Number(e.target.value)))
              }
            />
            <span className="faint" style={{ minWidth: '3em', textAlign: 'right' }}>
              {Math.round(segment.ambience.reverb * 100)}
            </span>
          </div>
          <p className="faint" style={{ margin: '8px 0 0' }}>
            {t('studio.reverbNote')}
          </p>
        </li>

        <li className="card">
          <p className="section-label" style={{ margin: '0 0 10px' }}>
            {t('studio.fade')}
          </p>
          {(['fadeInSec', 'fadeOutSec'] as const).map((key) => (
            <div className="row" key={key} style={{ marginBottom: 8 }}>
              <span className="faint" style={{ minWidth: '5em' }}>
                {key === 'fadeInSec' ? t('studio.fadeIn') : t('studio.fadeOut')}
              </span>
              <input
                type="range"
                min={0}
                max={Math.min(300, durationSec / 4)}
                step={1}
                value={segment[key]}
                onChange={(e) =>
                  update((next) => void (next.segments[0]![key] = Number(e.target.value)))
                }
              />
              <span className="faint" style={{ minWidth: '4em', textAlign: 'right' }}>
                {t('studio.seconds', { n: segment[key] })}
              </span>
            </div>
          ))}
          <label className="switch" style={{ marginTop: 10 }}>
            <input
              type="checkbox"
              checked={segment.chimeAtEnd}
              onChange={(e) =>
                update((next) => void (next.segments[0]!.chimeAtEnd = e.target.checked))
              }
            />
            <span>{t('studio.chimeAtEnd')}</span>
          </label>
        </li>

        <li className="card">
          <div className="row-between">
            <span>{t('studio.json')}</span>
            <button className="btn" onClick={() => setShowJson(!showJson)}>
              {showJson ? t('common.close') : t('common.open')}
            </button>
          </div>
          {showJson && (
            <div style={{ marginTop: 12 }}>
              <textarea
                className="json-box"
                readOnly
                value={exportPresetJson(draft)}
                onFocus={(e) => e.currentTarget.select()}
                rows={6}
              />
              <p className="faint" style={{ margin: '10px 0 6px' }}>
                {t('studio.jsonImportLabel')}
              </p>
              <textarea
                className="json-box"
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                rows={4}
                placeholder={t('studio.jsonPlaceholder')}
              />
              <button className="btn" style={{ marginTop: 8 }} onClick={doImport}>
                {t('studio.import')}
              </button>
            </div>
          )}
        </li>
      </ul>

      <div className="start-row">
        <div className="controls">
          <button className="btn btn-primary" onClick={save}>
            {t('common.save')}
          </button>
          <button className="btn" onClick={() => void startSession()}>
            {t('studio.playThis')}
          </button>
          <button className="btn" onClick={() => setView('export')}>
            {t('studio.export')}
          </button>
          <button className="btn btn-danger" onClick={remove}>
            {t('common.delete')}
          </button>
        </div>
        <p className="faint" style={{ margin: 0 }}>
          {t('studio.curveFooter', {
            sec: Math.round(curveDurationSec(segment.beat.curve)),
            max: BEAT_MAX_HZ,
          })}
        </p>
      </div>
    </>
  );
}
