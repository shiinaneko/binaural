import { useEffect } from 'react';
import {
  reacquireWakeLockIfNeeded,
  resyncDisplay,
  setVolume,
  skipSegment,
  startSession,
  stopSession,
  togglePause,
} from '../state/controller';
import { useAppStore } from '../state/store';
import { findPreset } from '../presets/sessions';
import { Export } from './Export';
import { HeadphoneCheck } from './HeadphoneCheck';
import { Home } from './Home';
import { SafetyNotice } from './SafetyNotice';
import { SessionView } from './SessionView';
import { Settings } from './Settings';
import { Studio } from './Studio';

export function App() {
  const view = useAppStore((s) => s.view);
  const presetId = useAppStore((s) => s.presetId);
  const safetyAcknowledged = useAppStore((s) => s.safetyAcknowledged);
  const acknowledgeSafety = useAppStore((s) => s.acknowledgeSafety);

  const language = useAppStore((s) => s.language);
  const colorway = findPreset(presetId)?.colorway ?? 'indigo';

  // 画面言語を <html lang> にも反映する（読み上げやフォント選択のため）
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  // タブ復帰時: 表示を追いつかせ、解放された WakeLock を取り直す（音はずれていない）
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        resyncDisplay();
        reacquireWakeLockIfNeeded();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  // キーボード操作（SPEC.md §7.3）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;

      const state = useAppStore.getState();
      const status = state.runtime.status;

      switch (e.key) {
        case ' ': {
          e.preventDefault();
          if (status === 'running' || status === 'paused') void togglePause();
          else if (state.view === 'home') void startSession();
          break;
        }
        case 'ArrowUp':
          e.preventDefault();
          setVolume(Math.min(1, state.volume + 0.05));
          break;
        case 'ArrowDown':
          e.preventDefault();
          setVolume(Math.max(0, state.volume - 0.05));
          break;
        case 'n':
        case 'N':
          if (status === 'running') skipSegment();
          break;
        case 'd':
        case 'D':
          if (status === 'running' || status === 'paused') state.setDimmed(!state.dimmed);
          break;
        case 'Escape':
          if (state.dimmed) state.setDimmed(false);
          else if (status === 'running' || status === 'paused') void stopSession();
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="app" data-colorway={colorway}>
      {!safetyAcknowledged && <SafetyNotice mode="first-run" onAcknowledge={acknowledgeSafety} />}
      {view === 'home' && <Home />}
      {view === 'session' && <SessionView />}
      {view === 'headphone' && <HeadphoneCheck />}
      {view === 'settings' && <Settings />}
      {view === 'export' && <Export />}
      {view === 'studio' && <Studio />}
    </div>
  );
}
