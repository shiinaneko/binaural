interface ProgressRingProps {
  /** 0–1 */
  progress: number;
  children: React.ReactNode;
}

const RADIUS = 46;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function ProgressRing({ progress, children }: ProgressRingProps) {
  const clamped = Math.min(Math.max(progress, 0), 1);
  return (
    <div className="ring-wrap">
      <svg className="ring" viewBox="0 0 100 100" aria-hidden="true">
        <circle className="ring-track" cx="50" cy="50" r={RADIUS} />
        <circle
          className="ring-value"
          cx="50"
          cy="50"
          r={RADIUS}
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={CIRCUMFERENCE * (1 - clamped)}
        />
      </svg>
      <div className="ring-center">{children}</div>
    </div>
  );
}
