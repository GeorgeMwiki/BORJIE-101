interface SparklineProps {
  readonly values: ReadonlyArray<number>;
  readonly width?: number;
  readonly height?: number;
  readonly label?: string;
}

/**
 * Minimalist inline SVG sparkline — no external chart library, so it
 * renders identically server-side and client-side. Values are 0..1.
 * Uses `currentColor` so the parent text colour controls the stroke.
 */
export function Sparkline({
  values,
  width = 120,
  height = 32,
  label,
}: SparklineProps): JSX.Element {
  if (values.length === 0) {
    return <svg width={width} height={height} aria-hidden="true" />;
  }

  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;
  const step = width / Math.max(values.length - 1, 1);

  const points = values
    .map((v, i) => {
      const x = i * step;
      const y = height - ((v - min) / range) * (height - 2) - 1;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');

  return (
    <svg
      width={width}
      height={height}
      role={label ? 'img' : undefined}
      aria-label={label}
      className="text-signal-500"
    >
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
