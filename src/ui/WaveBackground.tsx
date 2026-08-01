/**
 * 背景の静かな波。
 *
 * 設計上の制約が 3 つある:
 *
 * 1. **点滅を作らない。** 仕様どおり、変化は 0.2 Hz 以下のごく緩やかなものに限る。
 * 2. **CPU をほとんど使わない。** 25 分以上動き続ける横で音を合成しているので、
 *    毎フレームの JS 描画（canvas）は避ける。ここでは CSS の `transform` だけで
 *    動かしており、合成は GPU に任せられる。Android で音が途切れた経緯があるため、
 *    背景のために音を犠牲にしてはいけない。
 * 3. `prefers-reduced-motion` では止める。
 *
 * 見た目の作り方: 波長の違う 3 層を**非整数比の速度**で横に流す。
 * 層が重なってできる模様は合成周期が非常に長くなるため、
 * 「同じ動きの繰り返し」として知覚されない。
 *
 * 各層は幅の半分ぶん動かして原点に戻る。波長が半幅を割り切るようにしてあるので、
 * 折り返しで波形が飛ばない（＝継ぎ目が見えない）。
 */

const WIDTH = 2400;
const HEIGHT = 320;
/** 半幅（=1200）を割り切る波長にすること。折り返しを繋ぐため。 */
const LAYERS = [
  { wavelength: 400, amplitude: 26, y: 150, opacity: 0.16, duration: 61 },
  { wavelength: 300, amplitude: 20, y: 186, opacity: 0.12, duration: 89 },
  { wavelength: 240, amplitude: 15, y: 214, opacity: 0.09, duration: 127 },
];

/**
 * 正弦を下端まで塗りつぶしたパスを作る。
 *
 * 表示時に横へ大きく引き伸ばすので、点を直線で繋ぐと折れ線が見えてしまう。
 * 隣り合う点の中点を通る二次ベジェで結び、点の数に関わらず滑らかにする。
 */
function wavePath(wavelength: number, amplitude: number, y: number): string {
  const step = wavelength / 16;
  const points: Array<[number, number]> = [];
  for (let x = 0; x <= WIDTH + step; x += step) {
    points.push([x, y + Math.sin((x / wavelength) * Math.PI * 2) * amplitude]);
  }

  const segments: string[] = [`M${points[0]![0]} ${points[0]![1].toFixed(2)}`];
  for (let i = 1; i < points.length; i++) {
    const [px, py] = points[i - 1]!;
    const [cx, cy] = points[i]!;
    const midX = (px + cx) / 2;
    const midY = (py + cy) / 2;
    // 制御点は前の点。中点を通ることで曲線が連続する
    segments.push(`Q${px.toFixed(2)} ${py.toFixed(2)} ${midX.toFixed(2)} ${midY.toFixed(2)}`);
  }

  return `M0 ${HEIGHT} L0 ${points[0]![1].toFixed(2)} ${segments
    .slice(1)
    .join(' ')} L${WIDTH} ${HEIGHT} Z`;
}

export function WaveBackground() {
  return (
    <div className="waves" aria-hidden="true">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none">
        {LAYERS.map((layer, index) => (
          <g
            key={index}
            className="wave-layer"
            style={{ animationDuration: `${layer.duration}s`, opacity: layer.opacity }}
          >
            <path d={wavePath(layer.wavelength, layer.amplitude, layer.y)} />
            {/* 折り返し用に同じ波をもう 1 枚、真横に並べる */}
            <path
              d={wavePath(layer.wavelength, layer.amplitude, layer.y)}
              transform={`translate(${WIDTH} 0)`}
            />
          </g>
        ))}
      </svg>
    </div>
  );
}
