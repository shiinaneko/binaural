/**
 * ヘッドホンチェック（SPEC.md §7.1-5）。
 * 左右の装着 → うなりの可聴確認 → 音量調整、の 3 段。
 */

import { useEffect, useState } from 'react';
import { setVolume, startTestTone, stopTestTone } from '../state/controller';
import { useAppStore } from '../state/store';
import { useT } from './useT';

type Playing = 'left' | 'right' | 'beat' | null;

export function HeadphoneCheck() {
  const t = useT();
  const [playing, setPlaying] = useState<Playing>(null);
  const volume = useAppStore((s) => s.volume);
  const markHeadphoneChecked = useAppStore((s) => s.markHeadphoneChecked);
  const setView = useAppStore((s) => s.setView);

  useEffect(() => stopTestTone, []);

  const toggle = async (next: Exclude<Playing, null>) => {
    if (playing === next) {
      stopTestTone();
      setPlaying(null);
      return;
    }
    const opts =
      next === 'beat'
        ? { side: 'both' as const, beatHz: 6, carrierHz: 240 }
        : { side: next, carrierHz: 240 };
    await startTestTone(opts);
    setPlaying(next);
  };

  const done = () => {
    stopTestTone();
    markHeadphoneChecked();
    setView('home');
  };

  return (
    <>
      <div className="topbar">
        <h1 className="brand">
          {t('headphone.title')} <span>/ {t('headphone.steps')}</span>
        </h1>
        <button
          className="btn btn-ghost"
          onClick={() => {
            stopTestTone();
            setView('home');
          }}
        >
          {t('common.back')}
        </button>
      </div>

      <div className="card">
        <div className="check-step">
          <h3>{t('headphone.step1')}</h3>
          <p className="faint" style={{ margin: 0 }}>
            {t('headphone.step1Hint')}
          </p>
          <div className="hold-buttons">
            <button
              className="btn"
              aria-pressed={playing === 'left'}
              onClick={() => void toggle('left')}
            >
              {playing === 'left' ? t('headphone.stop') : t('headphone.left')}
            </button>
            <button
              className="btn"
              aria-pressed={playing === 'right'}
              onClick={() => void toggle('right')}
            >
              {playing === 'right' ? t('headphone.stop') : t('headphone.right')}
            </button>
          </div>
        </div>

        <div className="check-step">
          <h3>{t('headphone.step2')}</h3>
          <p className="faint" style={{ margin: 0 }}>
            {t('headphone.step2Hint')}
            <br />
            {t('headphone.step2Hint2')}
          </p>
          <div className="hold-buttons">
            <button
              className="btn"
              aria-pressed={playing === 'beat'}
              onClick={() => void toggle('beat')}
            >
              {playing === 'beat' ? t('headphone.stop') : t('headphone.playBeat')}
            </button>
          </div>
        </div>

        <div className="check-step">
          <h3>{t('headphone.step3')}</h3>
          <p className="faint" style={{ margin: 0 }}>
            {t('headphone.step3Hint')}
          </p>
          <div className="row">
            <span className="faint">{t('home.volume')}</span>
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
        </div>
      </div>

      <div className="start-row">
        <button className="btn btn-primary" onClick={done}>
          {t('headphone.done')}
        </button>
        <p className="faint" style={{ margin: 0 }}>
          {t('headphone.bluetooth')}
        </p>
      </div>
    </>
  );
}
