/**
 * セッションのタイムライン管理（SPEC.md §4.1 / §6）。
 *
 * 時間源は AudioContext.currentTime だけ。setInterval は表示更新と
 * 先読みスケジューリングのトリガにしか使わない（オーディオクロックが唯一の正）。
 *
 * 一時停止は AudioContext.suspend() で行う。suspend 中は currentTime が進まないため、
 * 事前にスケジュール済みの自動化と経過時間の関係が崩れない。
 */

import type { AudioEngine } from './AudioEngine';
import { beatHzAt, bridgeCurve, curveDurationSec } from './BeatCurve';
import { CHIME_TAIL_SEC } from './chime';
import { isOfflineContext } from './context';
import { SEGMENT_CROSSFADE_SEC, type Segment, type SessionPreset } from './types';

export interface TimelineEntry {
  index: number;
  segment: Segment;
  startSec: number;
  endSec: number;
}

export interface SessionTimeline {
  entries: TimelineEntry[];
  totalSec: number;
}

export type SessionPhase = 'onset' | 'plateau' | 'taper';

/**
 * プリセットを実際の並びへ展開する。
 * cycles があれば focus / shortBreak の単位を繰り返し、最後の shortBreak は longBreak に置き換える。
 */
export function buildTimeline(preset: SessionPreset): SessionTimeline {
  const longBreak = preset.segments.find((s) => s.kind === 'longBreak');
  const unit = preset.segments.filter((s) => s.kind !== 'longBreak');
  const cycles = Math.max(1, preset.cycles ?? 1);

  const ordered: Segment[] = [];
  if (!preset.cycles || preset.cycles <= 1) {
    ordered.push(...preset.segments);
  } else {
    for (let c = 0; c < cycles; c++) {
      for (const s of unit) {
        const isLastCycle = c === cycles - 1;
        if (isLastCycle && s.kind === 'shortBreak' && longBreak) continue;
        ordered.push(s);
      }
    }
    if (longBreak) ordered.push(longBreak);
  }

  const entries: TimelineEntry[] = [];
  let cursor = 0;
  ordered.forEach((segment, index) => {
    entries.push({ index, segment, startSec: cursor, endSec: cursor + segment.durationSec });
    cursor += segment.durationSec;
  });

  return { entries, totalSec: cursor };
}

export interface SessionSchedulerOptions {
  engine: AudioEngine;
  timeline: SessionTimeline;
  /** 何秒先までスケジュールしておくか（既定 600 秒） */
  lookaheadSec?: number;
  /** 全セグメント終了時に呼ばれる */
  onComplete?: () => void;
  /** セグメントが切り替わったときに呼ばれる */
  onSegmentChange?: (entry: TimelineEntry) => void;
}

export type SchedulerState = 'idle' | 'running' | 'stopping' | 'completed';

export class SessionScheduler {
  private readonly engine: AudioEngine;
  private readonly timeline: SessionTimeline;
  private readonly lookaheadSec: number;
  private readonly offline: boolean;
  private readonly onComplete?: () => void;
  private readonly onSegmentChange?: (entry: TimelineEntry) => void;

  private t0 = 0;
  private state: SchedulerState = 'idle';
  /** 次にスケジュールすべきエントリの添字 */
  private nextIndex = 0;
  /** 直前にスケジュールしたセグメント末尾の Δf（境界での跳躍を防ぐ橋渡しに使う） */
  private lastScheduledHz: number | null = null;
  private notifiedIndex = -1;
  private endsAtSec: number;

  constructor(opts: SessionSchedulerOptions) {
    this.engine = opts.engine;
    this.timeline = opts.timeline;
    this.offline = isOfflineContext(opts.engine.ctx);
    // オフラインでは currentTime が進まないため tick で先読みを延ばせない。
    // 全セグメントを開始時に予約しきる。
    this.lookaheadSec = opts.lookaheadSec ?? (this.offline ? Infinity : 600);
    this.onComplete = opts.onComplete;
    this.onSegmentChange = opts.onSegmentChange;
    this.endsAtSec = opts.timeline.totalSec;
  }

  /**
   * セッションを開始する。startDelaySec は最初のイベントまでの余白
   * （AudioContext のスケジューリング精度のため、ごく短い先出しを入れる）。
   */
  start(startDelaySec = 0.05): void {
    if (this.state !== 'idle') return;
    const first = this.timeline.entries[0];
    if (!first) return;

    this.t0 = this.engine.ctx.currentTime + startDelaySec;
    this.state = 'running';

    const pair = this.engine.createPair(first.segment.beat, this.t0);
    pair.start(this.t0);
    this.engine.startLayers(this.t0);

    // セッション開始のフェードイン
    this.engine.fadeSession(0, this.t0, 0);
    this.engine.fadeSession(1, this.t0, first.segment.fadeInSec);

    this.scheduleAhead();
  }

  /**
   * 先読みしてまだスケジュールしていないセグメントを積む。
   * 25 分セグメント × 数本ぶんの自動化を一度に入れないための分割。
   */
  scheduleAhead(): void {
    if (this.state !== 'running') return;
    const horizon = this.elapsedSec + this.lookaheadSec;

    while (this.nextIndex < this.timeline.entries.length) {
      const entry = this.timeline.entries[this.nextIndex]!;
      if (entry.startSec > horizon) break;
      this.scheduleEntry(entry);
      this.nextIndex++;
    }
  }

  private scheduleEntry(entry: TimelineEntry): void {
    const { segment } = entry;
    const at = this.t0 + entry.startSec;
    const pair = this.engine.currentPair;
    if (!pair) return;

    const isFirst = entry.index === 0;
    const isLast = entry.index === this.timeline.entries.length - 1;

    // Δf カーブ。境界では直前の値から橋渡しして跳躍を防ぐ。
    const bridged =
      this.lastScheduledHz === null
        ? segment.beat.curve
        : bridgeCurve(this.lastScheduledHz, segment.beat.curve, SEGMENT_CROSSFADE_SEC);

    pair.scheduleCurve(at, bridged, {
      carrierHz: segment.beat.carrierHz,
      carrierGlideSec: isFirst ? 0 : SEGMENT_CROSSFADE_SEC,
    });
    this.lastScheduledHz = beatHzAt(bridged, curveDurationSec(bridged));

    // パッドなど音高を持つレイヤーに搬送波を先に伝える（この後の生成時に反映される）
    this.engine.setTonalCenter(segment.beat.carrierHz, at);

    // 環境音は境界でクロスフェード。先頭はフェードインに任せて即時設定。
    this.engine.applyAmbienceMix(segment.ambience, at, isFirst ? 0 : SEGMENT_CROSSFADE_SEC);

    // 粒（雨など）の予約。
    // オフラインでは tick を回す機会がないので、ここでセグメント末尾までを予約しきる。
    // リアルタイムではやらない（25 分ぶんの雨粒を一度に作ると数万ノードになる）。
    // リアルタイム側は controller の tick が 0.6 秒先まで繰り返し予約する。
    if (this.offline) {
      this.engine.pumpLayers(this.t0 + entry.endSec);
    }

    if (segment.chimeAtEnd) {
      this.engine.chime(this.t0 + entry.endSec);
    }

    if (isLast) {
      // 終了フェードと発音停止
      this.engine.fadeSession(0, this.t0 + entry.endSec - segment.fadeOutSec, segment.fadeOutSec);
      this.engine.stopAll(this.t0 + entry.endSec + 0.2);
      this.endsAtSec = entry.endSec;
    }
  }

  /**
   * 定期的に呼ぶ。先読みの延長と完了判定を行う。
   * 呼び出し間隔は 250ms 程度でよい（時間の正確さはオーディオクロックが担保する）。
   */
  tick(): void {
    if (this.state !== 'running') return;
    this.scheduleAhead();

    const current = this.currentEntry;
    if (current && current.index !== this.notifiedIndex) {
      this.notifiedIndex = current.index;
      this.onSegmentChange?.(current);
    }

    if (this.elapsedSec >= this.endsAtSec) {
      this.state = 'completed';
      this.onComplete?.();
    }
  }

  /**
   * ユーザー操作による終了。fadeOutSec でフェードしてから発音を止める。
   * @returns 音が完全に消えるまでの秒数
   */
  stop(fadeOutSec = 3): number {
    if (this.state !== 'running') return 0;
    this.state = 'stopping';
    const now = this.engine.ctx.currentTime;
    this.engine.fadeOutNow(fadeOutSec);
    this.engine.stopAll(now + fadeOutSec + 0.2);
    return fadeOutSec + 0.2;
  }

  /**
   * 現在のセグメントを飛ばす。事前スケジュール済みの自動化を捨てて、
   * 次のセグメントを「今」から始まるように時間原点をずらす。
   */
  skipToNext(): boolean {
    if (this.state !== 'running') return false;
    const current = this.currentEntry;
    if (!current) return false;
    const next = this.timeline.entries[current.index + 1];
    if (!next) return false;

    const now = this.engine.ctx.currentTime;
    // 原点をずらすと、以降の startSec がそのまま「今」に対応する
    this.t0 = now - next.startSec;
    this.nextIndex = next.index;
    this.notifiedIndex = -1;
    this.scheduleAhead();
    return true;
  }

  // -------------------------------------------------------------------------
  // 参照系
  // -------------------------------------------------------------------------

  get elapsedSec(): number {
    if (this.state === 'idle') return 0;
    return Math.max(0, this.engine.ctx.currentTime - this.t0);
  }

  get remainingSec(): number {
    return Math.max(0, this.endsAtSec - this.elapsedSec);
  }

  get totalSec(): number {
    return this.timeline.totalSec;
  }

  get schedulerState(): SchedulerState {
    return this.state;
  }

  get currentEntry(): TimelineEntry | null {
    const t = this.elapsedSec;
    for (const entry of this.timeline.entries) {
      if (t < entry.endSec) return entry;
    }
    return this.timeline.entries[this.timeline.entries.length - 1] ?? null;
  }

  /** セグメント内の経過秒 */
  get segmentElapsedSec(): number {
    const entry = this.currentEntry;
    if (!entry) return 0;
    return Math.max(0, this.elapsedSec - entry.startSec);
  }

  get segmentRemainingSec(): number {
    const entry = this.currentEntry;
    if (!entry) return 0;
    return Math.max(0, entry.endSec - this.elapsedSec);
  }

  /** 表示用の現在 Δf。カーブから解析的に求めるので、ノードを覗く必要がない。 */
  get currentBeatHz(): number {
    const entry = this.currentEntry;
    if (!entry) return 0;
    return beatHzAt(entry.segment.beat.curve, this.segmentElapsedSec);
  }

  /** 導入 / 保持 / 収束のどの相にいるか */
  get phase(): SessionPhase {
    const entry = this.currentEntry;
    if (!entry) return 'plateau';
    const points = entry.segment.beat.curve.points;
    if (points.length < 3) return 'plateau';
    const t = this.segmentElapsedSec;
    const onsetEnd = points[1]!.t;
    const taperStart = points[points.length - 2]!.t;
    if (t < onsetEnd) return 'onset';
    if (t >= taperStart) return 'taper';
    return 'plateau';
  }

  /** 全体の進捗 0–1 */
  get progress(): number {
    if (this.endsAtSec <= 0) return 0;
    return Math.min(1, this.elapsedSec / this.endsAtSec);
  }
}

export { CHIME_TAIL_SEC };
