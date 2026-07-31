/**
 * ヘッドホンチェック（SPEC.md §7.1-5）。
 * 左右の装着 → うなりの可聴確認 → 音量調整、の 3 段。
 */

import { useEffect, useState } from 'react';
import { setVolume, startTestTone, stopTestTone } from '../state/controller';
import { useAppStore } from '../state/store';

type Playing = 'left' | 'right' | 'beat' | null;

export function HeadphoneCheck() {
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
          ヘッドホンチェック <span>/ 3 ステップ</span>
        </h1>
        <button
          className="btn btn-ghost"
          onClick={() => {
            stopTestTone();
            setView('home');
          }}
        >
          戻る
        </button>
      </div>

      <div className="card">
        <div className="check-step">
          <h3>1. 左右が合っているか</h3>
          <p className="faint" style={{ margin: 0 }}>
            片方ずつ鳴らします。表示と聞こえる側が一致していれば正しく装着できています。
          </p>
          <div className="hold-buttons">
            <button className="btn" aria-pressed={playing === 'left'} onClick={() => void toggle('left')}>
              {playing === 'left' ? '■ 停止' : '◀ 左だけ鳴らす'}
            </button>
            <button
              className="btn"
              aria-pressed={playing === 'right'}
              onClick={() => void toggle('right')}
            >
              {playing === 'right' ? '■ 停止' : '右だけ鳴らす ▶'}
            </button>
          </div>
        </div>

        <div className="check-step">
          <h3>2. うなりが聞こえるか</h3>
          <p className="faint" style={{ margin: 0 }}>
            左 237 Hz・右 243 Hz を同時に鳴らします。1 秒に 6 回ほど、
            ゆっくり波打つように聞こえればバイノーラルビートが機能しています。
            <br />
            聞こえない場合はスピーカー再生になっている可能性があります。設定でモノラルビートに
            切り替えると、スピーカーでも近い効果が得られます。
          </p>
          <div className="hold-buttons">
            <button className="btn" aria-pressed={playing === 'beat'} onClick={() => void toggle('beat')}>
              {playing === 'beat' ? '■ 停止' : '6 Hz のうなりを鳴らす'}
            </button>
          </div>
        </div>

        <div className="check-step">
          <h3>3. 音量を決める</h3>
          <p className="faint" style={{ margin: 0 }}>
            搬送波は「聞こえるが主役ではない」くらいが適量です。会話ができる程度に抑えてください
            （最大音量の 60% 以下を推奨）。
          </p>
          <div className="row">
            <span className="faint">音量</span>
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
        </div>
      </div>

      <div className="start-row">
        <button className="btn btn-primary" onClick={done}>
          確認しました
        </button>
        <p className="faint" style={{ margin: 0 }}>
          Bluetooth ヘッドホンでは、コーデックの処理で左右の位相関係が崩れることがあります。
          うなりが弱いと感じたら有線接続をお試しください。
        </p>
      </div>
    </>
  );
}
