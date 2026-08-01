/**
 * アイコン。外部リソースを使わない方針なので SVG を直接持つ。
 * 線幅と大きさは本文（15px）の横に並べても浮かない値に揃えてある。
 */

const base = {
  width: 19,
  height: 19,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

export function HeadphonesIcon() {
  return (
    <svg {...base}>
      {/* ヘッドバンド */}
      <path d="M4 15.5v-3.5a8 8 0 0 1 16 0v3.5" />
      {/* イヤーカップ */}
      <rect x="2.2" y="14.2" width="4.6" height="7" rx="1.8" />
      <rect x="17.2" y="14.2" width="4.6" height="7" rx="1.8" />
    </svg>
  );
}

/**
 * 歯車の輪郭を計算で作る。
 * 線だけで表そうとすると小さい表示では太陽や星に見えてしまうので、
 * 歯のある面として描き、中央を抜く（evenodd）。
 */
function gearPath(teeth = 8, outer = 10.8, root = 7.6, hole = 3.6): string {
  const cx = 12;
  const cy = 12;
  const step = (Math.PI * 2) / teeth;
  const toothHalf = step * 0.17;
  const valleyHalf = step * 0.28;
  const at = (radius: number, angle: number): string =>
    `${(cx + Math.cos(angle) * radius).toFixed(2)} ${(cy + Math.sin(angle) * radius).toFixed(2)}`;

  const points: string[] = [];
  for (let i = 0; i < teeth; i++) {
    const a = i * step - Math.PI / 2;
    points.push(at(outer, a - toothHalf));
    points.push(at(outer, a + toothHalf));
    points.push(at(root, a + valleyHalf));
    points.push(at(root, a + step - valleyHalf));
  }

  // 中央の穴。円を 2 つの弧で描き、evenodd で抜く
  const ring =
    `M${cx - hole} ${cy}` +
    ` a${hole} ${hole} 0 1 0 ${hole * 2} 0` +
    ` a${hole} ${hole} 0 1 0 ${-hole * 2} 0 Z`;

  return `M${points.join(' L')} Z ${ring}`;
}

const GEAR_PATH = gearPath();

export function GearIcon() {
  return (
    <svg width={19} height={19} viewBox="0 0 24 24" aria-hidden="true">
      <path d={GEAR_PATH} fill="currentColor" fillRule="evenodd" />
    </svg>
  );
}
