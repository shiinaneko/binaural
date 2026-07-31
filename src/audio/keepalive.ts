/**
 * バックグラウンド再生を維持するためのキープアライブ再生。
 *
 * Android Chrome は「メディアを再生していないページ」を、画面ロックやアプリ切り替えで
 * 凍結する。Web Audio は音を**その場で合成**しているだけなので、Chrome から見ると
 * メディアを再生していないことになり、音が止まってしまう（実機で確認済み）。
 *
 * `MediaStreamAudioDestinationNode` を `<audio>` に流す方法も試したが、
 * **Chrome は MediaStream をメディアセッションの対象にしない**ため空振りだった
 * （ロック画面に通知が出ず、バックグラウンドで停止した）。
 *
 * そこで **実ファイル** を `<audio>` でループ再生する。YouTube Music などが
 * バックグラウンドで鳴り続けるのと同じ経路に乗せ、ページを凍結対象から外すのが狙い。
 * 音そのものは従来どおり Web Audio が出す。
 *
 * ファイルは実行時に生成するので、配布物に音声アセットは増えない
 * （「音源ファイルを持たない」という方針も保たれる）。
 */

import { dbToGain } from './loudness';
import { mulberry32 } from './prng';
import { createWavHeader, PcmQuantizer } from './render/wav';

/**
 * キープアライブ音のレベル。
 *
 * デジタル無音（全サンプル 0）にはしない。ブラウザが「非可聴」と判定すると
 * メディアセッションを張らず、この仕組み自体が成立しなくなるため。
 * −55 dBFS は本編（−25 dBFS 前後）より 30 dB 低く、実質聞こえない。
 */
const LEVEL_DB = -55;
const SAMPLE_RATE = 22050;
const DURATION_SEC = 10;

/** ループ再生用の極小レベルのノイズを WAV として生成する */
function createKeepaliveWav(): Blob {
  const frames = SAMPLE_RATE * DURATION_SEC;
  const data = new Float32Array(frames);
  const rand = mulberry32(0x6b656570);
  const amplitude = dbToGain(LEVEL_DB);
  for (let i = 0; i < frames; i++) {
    data[i] = (rand() * 2 - 1) * amplitude;
  }

  const header = createWavHeader({
    sampleRate: SAMPLE_RATE,
    channels: 1,
    bitDepth: 16,
    totalFrames: frames,
  });
  const pcm = new PcmQuantizer(16).encode([data]);
  return new Blob([header, pcm], { type: 'audio/wav' });
}

export interface Keepalive {
  element: HTMLAudioElement;
  /** 再生を止めて資源を解放する */
  release(): void;
}

/**
 * キープアライブ要素を作って再生を始める。
 * `play()` の成功を待って返すので、失敗したら null になる（呼び出し側で判断できる）。
 */
export async function startKeepalive(): Promise<Keepalive | null> {
  try {
    const url = URL.createObjectURL(createKeepaliveWav());
    const element = new Audio(url);
    element.loop = true;
    element.preload = 'auto';
    // iOS でインライン再生させるための指定（Android では無害）
    element.setAttribute('playsinline', '');
    element.volume = 1; // ファイル自体が −55 dBFS なので実質無音
    // DOM に入れておく。文書に属さないメディア要素を
    // 「再生中のメディア」として扱わないブラウザがあるため
    element.style.display = 'none';
    document.body.appendChild(element);

    await element.play();

    return {
      element,
      release() {
        element.pause();
        element.removeAttribute('src');
        element.load();
        element.remove();
        URL.revokeObjectURL(url);
      },
    };
  } catch {
    return null;
  }
}
