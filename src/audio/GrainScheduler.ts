/**
 * 粒（グレイン）のルックアヘッド生成（SPEC.md §3.3）。
 *
 * 雨粒や焚き火のパチパチは、確率的に発生する短い音の集まりとして作る。
 * Poisson 過程で次の発音時刻を決め、pump(untilTime) で「その時刻までに鳴るぶん」を
 * まとめて予約する。
 *
 * この pump 方式にしているのは、リアルタイム再生（250ms ごとに 0.5 秒先まで）と
 * オフライン書き出し（全長を一度に）で同じコードを使うため。
 * 発音時刻はシード付き PRNG から決まるので、同じシードなら常に同じ雨になる。
 */

export class GrainScheduler {
  private nextTime: number | null = null;
  private ratePerSec: number;
  private readonly rand: () => number;
  /** 一度の pump で作りすぎないための安全弁 */
  private readonly maxPerPump: number;
  /** 開始からの通し番号。粒ごとのパラメータはこの番号から決める（下記参照） */
  private index = 0;

  constructor(rand: () => number, ratePerSec: number, maxPerPump = 20000) {
    this.rand = rand;
    this.ratePerSec = ratePerSec;
    this.maxPerPump = maxPerPump;
  }

  start(when: number): void {
    this.nextTime = when;
    this.index = 0;
  }

  /**
   * 発音せずに untilSec まで進める。
   *
   * 分割レンダリングで使う。チャンクごとに 0 から始めて境界まで空回しすることで、
   * どのチャンクでもまったく同じ粒の並びになる（＝境界の重なり部分で内容が一致し、
   * クロスフェードが形式的なものになる）。maxPerPump の制限は掛けない。
   *
   * @returns 飛ばした粒の数（通し番号の続きから再開するために使う）
   */
  skipTo(untilSec: number): number {
    if (this.nextTime === null || this.ratePerSec <= 0) {
      this.nextTime = untilSec;
      return 0;
    }
    const before = this.index;
    while (this.nextTime < untilSec) {
      const u = this.rand();
      this.nextTime += -Math.log(1 - Math.min(u, 0.999999)) / this.ratePerSec;
      this.index++;
    }
    return this.index - before;
  }

  setRate(ratePerSec: number): void {
    this.ratePerSec = Math.max(ratePerSec, 0);
  }

  get started(): boolean {
    return this.nextTime !== null;
  }

  /**
   * untilTime までに鳴る粒を spawn で予約する。
   *
   * @param spawn 発音時刻と通し番号を受け取る。
   *   **粒ごとのパラメータ（どの滴・再生レート・定位）は必ずこの通し番号から導くこと。**
   *   別の乱数列から引くと、分割レンダリングで途中から始めたときに
   *   同じ時刻の粒が別のパラメータになり、一括描画と音が食い違う（実際にやらかした）。
   */
  pump(untilTime: number, spawn: (time: number, index: number) => void): void {
    if (this.nextTime === null || this.ratePerSec <= 0) return;

    let count = 0;
    while (this.nextTime <= untilTime && count < this.maxPerPump) {
      spawn(this.nextTime, this.index);
      this.index++;
      // 指数分布: 間隔 = −ln(1−u) / rate
      const u = this.rand();
      const gap = -Math.log(1 - Math.min(u, 0.999999)) / this.ratePerSec;
      this.nextTime += gap;
      count++;
    }

    if (count >= this.maxPerPump) {
      // 想定より遠い未来まで要求された。取りこぼしを防ぐため位置だけ進める。
      this.nextTime = Math.max(this.nextTime, untilTime);
    }
  }
}
