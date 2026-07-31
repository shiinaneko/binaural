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

/**
 * 本編（Web Audio）と**同じ形式**にする。
 *
 * 最初は 22.05 kHz モノで作ったが、実機でループのたびに音が途切れた。
 * サンプルレートやチャンネル数が違うと、Android 側が 2 つの出力を
 * 組み替える必要が出て、そこで途切れると考えられる。
 */
const SAMPLE_RATE = 48000;
const CHANNELS = 2;
/**
 * ループの回数自体を減らすため長めに取る（48kHz ステレオ 30 秒 ≒ 5.8 MB）。
 *
 * なお、中身はホワイトノイズなので**ループ点に波形の飛びは無い**
 * （隣り合うサンプルが元々無関係なため、継ぎ目も他の場所と統計的に同じ）。
 * ループのたびに音が途切れるとすれば、それは波形ではなく
 * メディア要素の再生が再開されること自体が原因なので、回数を減らして影響を薄める。
 */
const DURATION_SEC = 30;

/** ループ再生用の極小レベルのノイズを WAV として生成する */
function createKeepaliveWav(): Blob {
  const frames = SAMPLE_RATE * DURATION_SEC;
  const amplitude = dbToGain(LEVEL_DB);
  const channels: Float32Array[] = [];

  for (let ch = 0; ch < CHANNELS; ch++) {
    const rand = mulberry32(0x6b656570 + ch * 0x9e3779b9);
    const out = new Float32Array(frames);
    for (let i = 0; i < frames; i++) out[i] = (rand() * 2 - 1) * amplitude;
    channels.push(out);
  }

  const header = createWavHeader({
    sampleRate: SAMPLE_RATE,
    channels: CHANNELS,
    bitDepth: 16,
    totalFrames: frames,
  });
  const pcm = new PcmQuantizer(16).encode(channels);
  return new Blob([header, pcm], { type: 'audio/wav' });
}

export interface Keepalive {
  element: HTMLAudioElement;
  /** 再生を止めて資源を解放する */
  release(): void;
}

/**
 * キープアライブの音を Web Audio の中に取り込み、出力を 1 本にまとめる。
 *
 * 既定ではキープアライブと本編が**別々の出力ストリーム**になる。
 * Android では 2 本のストリームを混ぜる過程（特に Bluetooth 経由）で
 * 音が途切れることがあるため、1 本にまとめられるようにしておく。
 *
 * 取り込むと要素の音は直接出力されなくなるので、この経路では
 * キープアライブの音自体は Web Audio 側から出る。ページが
 * 「メディアを再生中」である状態は要素が再生されている限り保たれる。
 *
 * 一度取り込んだ要素は直接出力に戻せない。セッションごとに作り直すこと。
 */
export function mergeKeepaliveInto(
  keepalive: Keepalive,
  ctx: AudioContext,
  destination: AudioNode,
): boolean {
  try {
    const source = ctx.createMediaElementSource(keepalive.element);
    source.connect(destination);
    return true;
  } catch {
    return false;
  }
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
