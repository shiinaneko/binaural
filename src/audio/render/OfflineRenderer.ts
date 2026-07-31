/**
 * 分割オフラインレンダリング（SPEC.md §9）。
 *
 * 25 分を一括で描画すると AudioBuffer だけで 576 MB、ポモドーロ 135 分では 3.1 GB になる。
 * そこで 5 分ずつに分けて描画し、PCM に落としながら捨てていく。
 *
 * 素朴に分割すると境界が繋がらない。対策は 3 つ:
 *
 * 1. **搬送波の位相**：チャンク開始時刻の累積位相を周波数の自動化から解析的に積分し、
 *    その位相を持つ `PeriodicWave` でオシレータを作る（phase.ts / waveform.ts）。
 * 2. **確率的な音源**：ノイズのループ位置・LFO の位相・雨粒の並びをすべて
 *    「セッションの絶対時刻」に整列させる（各レイヤーの alignSec）。
 *    こうするとチャンクをまたいでも同じ絶対時刻に同じ音が生成される。
 * 3. **フィルタとリバーブの過渡**：各チャンクの手前に 3 秒のプリロールを描画して捨てる。
 *    畳み込みの尾もバイキャッドの内部状態もここで定常に達する。
 *
 * その上で境界に 50 ms の線形クロスフェードを掛ける。1〜3 が効いていれば
 * 重なり部分の内容はほぼ一致しているので、これは保険にすぎない
 * （実測でも境界の隣接サンプル差分は通常部を超えない）。
 */

import { AudioEngine } from '../AudioEngine';
import { constantCurve } from '../BeatCurve';
import { clipBreakpoints, valueAt, type Breakpoint } from '../breakpoints';
import { LAYER_TAIL_SEC } from '../layers';
import { integratePhase, wrapPhase } from '../phase';
import { buildTimeline } from '../SessionScheduler';
import {
  buildTimelinePlan,
  tonalCenterAt,
  tonalCenterBreakpoints,
  type TimelinePlan,
} from '../timelinePlan';
import type { BeatConfig, SessionPreset } from '../types';
import { createWavHeader, estimateWavBytes, PcmQuantizer, type BitDepth } from './wav';

/** チャンク手前に描画して捨てる長さの下限。リバーブの減衰（既定 2.6 秒）より長く取る。 */
const MIN_PRE_ROLL_SEC = 3.0;

/**
 * プリロールの長さを決める。
 *
 * チャンクの手前で鳴り始めた音の「尾」を拾うために必要。シンギングボウルは
 * 20 秒かけて減衰するので、3 秒のプリロールでは境界で響きが消えてしまう。
 */
function preRollFor(plan: TimelinePlan): number {
  let tail = MIN_PRE_ROLL_SEC;
  for (const id of plan.layers.keys()) {
    tail = Math.max(tail, (LAYER_TAIL_SEC[id] ?? 0) + MIN_PRE_ROLL_SEC);
  }
  return tail;
}
/** 境界のクロスフェード長 */
const OVERLAP_SEC = 0.05;
/**
 * チャンク長。短くすると進捗の刻みが細かくなり、ピークメモリも減る。
 * 一方でチャンクごとに約 0.2 秒の準備コスト（ノイズバッファの合成など）がかかる。
 * 境界の連続性は実測で保証済みなので、分割数を増やしても音質は変わらない。
 */
const DEFAULT_CHUNK_SEC = 120;
const DEFAULT_SAMPLE_RATE = 48000;

export interface RenderRequest {
  preset: SessionPreset;
  bitDepth?: BitDepth;
  sampleRate?: number;
  chunkSec?: number;
  /**
   * ループ用の書き出し。フェードを省き、末尾で環境音のループ位置が先頭と揃う長さに丸める。
   * 外部プレーヤーでのギャップレス再生に使う。
   */
  seamlessLoop?: boolean;
  /** 0–1 の進捗 */
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

/**
 * ループ書き出しの長さを決める。
 *
 * ノイズのループ長（10 秒）の倍数に丸めると、環境音のループ位置が先頭と一致する
 * （各レイヤーは絶対時刻に整列しているため）。
 * 搬送波の位相は帯域の組み合わせによっては割り切れないので、残差を返して UI に出す。
 */
export function planLoopDuration(
  targetSec: number,
  leftHz: number,
  rightHz: number,
): { durationSec: number; phaseErrorDeg: number } {
  const grid = 10; // ノイズバッファの長さ
  const durationSec = Math.max(grid, Math.round(targetSec / grid) * grid);
  const fractional = (hz: number) => {
    const cycles = hz * durationSec;
    const off = cycles - Math.round(cycles);
    return Math.abs(off) * 360;
  };
  return { durationSec, phaseErrorDeg: Math.max(fractional(leftHz), fractional(rightHz)) };
}

export interface RenderResult {
  blob: Blob;
  fileName: string;
  bytes: number;
  durationSec: number;
  renderSec: number;
}

/** 書き出し前にサイズを見積もる（UI に必ず出す） */
export function estimateExportBytes(opts: {
  durationSec: number;
  bitDepth: BitDepth;
  sampleRate?: number;
}): number {
  const sampleRate = opts.sampleRate ?? DEFAULT_SAMPLE_RATE;
  return estimateWavBytes({
    sampleRate,
    channels: 2,
    bitDepth: opts.bitDepth,
    totalFrames: Math.round(opts.durationSec * sampleRate),
  });
}

export function buildFileName(preset: SessionPreset, plan: TimelinePlan): string {
  const beatHz = valueAt(plan.carrier.am, 0);
  const carrierHz = Math.round(
    (valueAt(plan.carrier.left, 0) + valueAt(plan.carrier.right, 0)) / 2,
  );
  const minutes = Math.round(plan.totalSec / 60);
  const slug = preset.id.replace(/[^a-zA-Z0-9-]/g, '');
  return `binaural_${slug}_${beatHz.toFixed(2)}Hz_${carrierHz}Hz_${minutes}min.wav`;
}

/** UI を固まらせないための小休止 */
function yieldToUi(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('書き出しを中断しました', 'AbortError');
  }
}

interface ChunkRequest {
  plan: TimelinePlan;
  sampleRate: number;
  /** 本体の開始・終了（セッションの絶対秒） */
  startSec: number;
  endSec: number;
  preRollSec: number;
  overlapSec: number;
}

/** 1 チャンクを描画する。返るバッファは [startSec − preRoll, endSec + overlap] を含む。 */
async function renderChunk(req: ChunkRequest): Promise<AudioBuffer> {
  const { plan, sampleRate, startSec, endSec, preRollSec, overlapSec } = req;
  const renderStart = Math.max(startSec - preRollSec, 0);
  const renderEnd = endSec + overlapSec;
  const renderDuration = renderEnd - renderStart;

  const frames = Math.max(1, Math.ceil(renderDuration * sampleRate));
  const ctx = new OfflineAudioContext(2, frames, sampleRate);
  const engine = new AudioEngine(ctx, { volume: 1 });

  // --- 搬送波 -------------------------------------------------------------
  // 境界で位相が飛ばないよう、開始時刻までの累積位相を解析的に求めて与える
  const initialPhase = {
    left: wrapPhase(integratePhase(plan.carrier.left, renderStart)),
    right: wrapPhase(integratePhase(plan.carrier.right, renderStart)),
    am: wrapPhase(integratePhase(plan.carrier.am, renderStart)),
  };

  const carrierAtStart =
    (valueAt(plan.carrier.left, renderStart) + valueAt(plan.carrier.right, renderStart)) / 2;
  const beat: BeatConfig = {
    mode: plan.mode,
    carrierHz: carrierAtStart,
    amDepth: plan.amDepth,
    curve: constantCurve(valueAt(plan.carrier.am, renderStart), renderDuration),
    gainDb: plan.gainDb,
  };

  const pair = engine.createPair(beat, 0, { initialPhase });
  pair.start(0);
  pair.applyCarrierBreakpoints(
    {
      left: clipBreakpoints(plan.carrier.left, renderStart, renderEnd),
      right: clipBreakpoints(plan.carrier.right, renderStart, renderEnd),
      am: clipBreakpoints(plan.carrier.am, renderStart, renderEnd),
    },
    0,
  );
  pair.applyGainBreakpoints(clipBreakpoints(plan.carrierGain, renderStart, renderEnd), 0);

  // --- 環境音 -------------------------------------------------------------
  // ここで wrapPhase してはいけない。パッドは声ごとに音高比を掛けてから畳むため、
  // 先に畳むと wrap(φ)×比 ≠ wrap(φ×比) となって位相が壊れる（実際にやらかした）。
  const padPhase = integratePhase(tonalCenterBreakpoints(plan), renderStart);

  for (const [id, levelPoints] of plan.layers) {
    const seed = plan.layerSeeds.get(id) ?? 1;
    const layer = engine.createAlignedLayer(id, seed, {
      alignSec: renderStart,
      carrierHz: tonalCenterAt(plan, renderStart),
      tonalPhase: padPhase,
    });
    if (!layer) continue;

    const clipped = clipBreakpoints(levelPoints, renderStart, renderEnd);
    // レベル → ゲインの写像は非線形なので、写像してから直線で繋ぐ
    // （リアルタイムの rampLevel もゲイン空間で繋いでいる）
    const gainPoints: Breakpoint[] = clipped.map((p) => ({
      t: p.t,
      value: layer.gainForLevel(p.value),
    }));
    for (let i = 0; i < gainPoints.length; i++) {
      const point = gainPoints[i]!;
      if (i === 0) {
        layer.output.gain.setValueAtTime(point.value, 0);
      } else {
        layer.output.gain.linearRampToValueAtTime(point.value, point.t);
      }
    }
  }

  engine.startLayers(0);
  engine.applyReverbBreakpoints(clipBreakpoints(plan.reverb, renderStart, renderEnd), 0);
  engine.applyFadeBreakpoints(clipBreakpoints(plan.fade, renderStart, renderEnd), 0);

  // 窓の中に入る音高中心の切り替えを反映する（パッドが搬送波に追随する）
  for (const tc of plan.tonalCenters) {
    if (tc.t > renderStart && tc.t <= renderEnd) {
      engine.setTonalCenter(tc.carrierHz, tc.t - renderStart);
    }
  }

  // 窓の中のチャイム
  for (const chimeAt of plan.chimes) {
    if (chimeAt >= renderStart && chimeAt <= renderEnd) {
      engine.chime(chimeAt - renderStart);
    }
  }

  // 粒はオフラインでは tick が無いので、全長ぶんをここで予約しきる
  engine.pumpLayers(renderDuration);

  return await ctx.startRendering();
}

/**
 * セッション全体を WAV に書き出す。
 * リアルタイム再生とまったく同じグラフ構築コード（AudioEngine / 各レイヤー）を通る。
 */
export async function renderSessionToWav(request: RenderRequest): Promise<RenderResult> {
  const startedAt = performance.now();
  const sampleRate = request.sampleRate ?? DEFAULT_SAMPLE_RATE;
  const bitDepth = request.bitDepth ?? 16;
  const chunkSec = request.chunkSec ?? DEFAULT_CHUNK_SEC;

  const timeline = buildTimeline(request.preset);
  const plan = buildTimelinePlan(timeline);

  let totalSec = plan.totalSec;
  if (request.seamlessLoop) {
    // フェードを外し、環境音のループが揃う長さに丸める
    const loop = planLoopDuration(
      plan.totalSec,
      valueAt(plan.carrier.left, 0),
      valueAt(plan.carrier.right, 0),
    );
    totalSec = loop.durationSec;
    plan.fade = [{ t: 0, value: 1 }];
  }
  const totalFrames = Math.round(totalSec * sampleRate);

  const parts: BlobPart[] = [
    createWavHeader({ sampleRate, channels: 2, bitDepth, totalFrames }),
  ];
  // ディザの流れはチャンクをまたいで continue させる
  const quantizer = new PcmQuantizer(bitDepth);

  const chunkFrames = Math.max(1, Math.round(chunkSec * sampleRate));
  const chunkCount = Math.max(1, Math.ceil(totalFrames / chunkFrames));
  const overlapFrames = Math.round(OVERLAP_SEC * sampleRate);
  const preRollSec = preRollFor(plan);

  /** 前チャンクの末尾（次チャンクの先頭と同じ絶対時刻を指す） */
  let pendingTail: [Float32Array, Float32Array] | null = null;

  for (let index = 0; index < chunkCount; index++) {
    assertNotAborted(request.signal);

    const startFrame = index * chunkFrames;
    const endFrame = Math.min(startFrame + chunkFrames, totalFrames);
    const bodyFrames = endFrame - startFrame;
    if (bodyFrames <= 0) break;

    const isLast = index === chunkCount - 1;
    const overlap = isLast ? 0 : OVERLAP_SEC;

    const buffer = await renderChunk({
      plan,
      sampleRate,
      startSec: startFrame / sampleRate,
      endSec: endFrame / sampleRate,
      preRollSec: index === 0 ? 0 : preRollSec,
      overlapSec: overlap,
    });

    const preRollFrames =
      index === 0 ? 0 : Math.round(Math.min(preRollSec, startFrame / sampleRate) * sampleRate);
    const left = buffer.getChannelData(0).subarray(preRollFrames);
    const right = buffer.getChannelData(1).subarray(preRollFrames);

    // 前チャンクの尾と重ねる（線形。搬送波は両者で完全に一致しているため
    // 等パワーではなく線形でないと合成振幅が +3 dB 持ち上がってしまう）
    if (pendingTail) {
      const n = Math.min(pendingTail[0].length, left.length);
      for (let i = 0; i < n; i++) {
        const u = (i + 0.5) / n;
        left[i] = pendingTail[0][i]! * (1 - u) + left[i]! * u;
        right[i] = pendingTail[1][i]! * (1 - u) + right[i]! * u;
      }
    }

    parts.push(quantizer.encode([left, right], 0, bodyFrames));

    const tailEnd = Math.min(bodyFrames + overlapFrames, left.length);
    pendingTail =
      !isLast && tailEnd > bodyFrames
        ? [left.slice(bodyFrames, tailEnd), right.slice(bodyFrames, tailEnd)]
        : null;

    request.onProgress?.((index + 1) / chunkCount);
    await yieldToUi();
  }

  const blob = new Blob(parts, { type: 'audio/wav' });
  return {
    blob,
    fileName: buildFileName(request.preset, plan),
    bytes: blob.size,
    durationSec: totalSec,
    renderSec: (performance.now() - startedAt) / 1000,
  };
}
