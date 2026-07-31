/**
 * Web Audio の最小モック。
 *
 * 実物は Node では動かないが、「いつ・どの値を予約したか」と
 * バッファ生成の中身（IR やノイズの DSP）は検証したい。
 * そのために AudioParam の自動化イベントを記録し、createBuffer だけは
 * 本物と同じ Float32Array を返すようにしてある。
 */

export interface ParamEvent {
  type: 'set' | 'ramp' | 'cancel' | 'hold' | 'exp';
  value?: number;
  time: number;
}

export class FakeParam {
  value = 0;
  events: ParamEvent[] = [];

  setValueAtTime(value: number, time: number) {
    this.events.push({ type: 'set', value, time });
    return this;
  }
  linearRampToValueAtTime(value: number, time: number) {
    this.events.push({ type: 'ramp', value, time });
    return this;
  }
  cancelScheduledValues(time: number) {
    this.events.push({ type: 'cancel', time });
    return this;
  }
  cancelAndHoldAtTime(time: number) {
    this.events.push({ type: 'hold', time });
    return this;
  }
  exponentialRampToValueAtTime(value: number, time: number) {
    this.events.push({ type: 'exp', value, time });
    return this;
  }
  setTargetAtTime(value: number, time: number) {
    this.events.push({ type: 'set', value, time });
    return this;
  }
}

export function fakeNode(extra: Record<string, unknown> = {}) {
  return {
    gain: new FakeParam(),
    connect: (target: unknown) => target,
    disconnect: () => undefined,
    ...extra,
  };
}

export function fakeBuffer(channels: number, length: number, sampleRate: number) {
  const data = Array.from({ length: channels }, () => new Float32Array(length));
  return {
    numberOfChannels: channels,
    length,
    sampleRate,
    duration: length / sampleRate,
    getChannelData: (ch: number) => data[ch]!,
  };
}

export interface FakeOscillator {
  frequency: FakeParam;
  detune: FakeParam;
  type: string;
  start(when: number): void;
  stop(when: number): void;
  setPeriodicWave(wave: unknown): void;
  connect(target: unknown): unknown;
  disconnect(): void;
}

export interface FakeContextHandle {
  ctx: BaseAudioContext;
  /** 生成された順のオシレータ。BinauralPair は L → R → AM の順に作る。 */
  oscillators: FakeOscillator[];
  gains: Array<{ gain: FakeParam }>;
}

export function fakeContext(sampleRate = 48000): BaseAudioContext {
  return createFakeContext(sampleRate).ctx;
}

/** 生成されたノードを覗きたいとき用（スケジューラの予約内容を検証する） */
export function createFakeContext(sampleRate = 48000): FakeContextHandle {
  const oscillators: FakeOscillator[] = [];
  const gains: Array<{ gain: FakeParam }> = [];

  const makeGain = () => {
    const node = fakeNode();
    gains.push(node as unknown as { gain: FakeParam });
    return node;
  };

  const ctx = {
    sampleRate,
    currentTime: 0,
    destination: fakeNode(),
    createGain: makeGain,
    createWaveShaper: () => fakeNode({ curve: null, oversample: 'none' }),
    createConvolver: () => fakeNode({ normalize: true, buffer: null }),
    createBiquadFilter: () =>
      fakeNode({ type: '', frequency: new FakeParam(), Q: new FakeParam() }),
    createChannelMerger: () => fakeNode(),
    createStereoPanner: () => fakeNode({ pan: new FakeParam() }),
    createPeriodicWave: () => ({}),
    createBufferSource: () =>
      fakeNode({
        buffer: null,
        loop: false,
        playbackRate: new FakeParam(),
        start: () => undefined,
        stop: () => undefined,
        onended: null,
      }),
    createOscillator: () => {
      const osc = fakeNode({
        frequency: new FakeParam(),
        detune: new FakeParam(),
        type: 'sine',
        start: () => undefined,
        stop: () => undefined,
        setPeriodicWave: () => undefined,
        onended: null,
      }) as unknown as FakeOscillator;
      oscillators.push(osc);
      return osc;
    },
    createBuffer: (channels: number, length: number, sr: number) =>
      fakeBuffer(channels, length, sr),
  } as unknown as BaseAudioContext;

  return { ctx, oscillators, gains };
}

/** ノードに紐づく FakeParam を取り出す */
export function paramOf(node: { gain: AudioParam }): FakeParam {
  return node.gain as unknown as FakeParam;
}
