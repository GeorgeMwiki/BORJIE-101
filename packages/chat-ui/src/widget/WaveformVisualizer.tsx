/**
 * WaveformVisualizer — compact animated bars for voice input level.
 *
 * Pure presentation component. Accepts a readonly numeric array (0..1)
 * sampled from the mic and renders a static SVG so it's cheap to re-mount.
 */
interface WaveformVisualizerProps {
  readonly levels: readonly number[];
  readonly active: boolean;
  readonly ariaLabel?: string;
}

export function WaveformVisualizer({ levels, active, ariaLabel }: WaveformVisualizerProps): JSX.Element {
  const bars = levels.length > 0 ? levels : Array.from({ length: 16 }, () => 0.1);
  return (
    <svg
      data-testid="waveform-visualizer"
      data-active={active ? 'true' : 'false'}
      role="img"
      aria-label={ariaLabel ?? 'Voice input level'}
      width={120}
      height={24}
      viewBox="0 0 120 24"
    >
      {bars.map((level, idx) => {
        const clamped = Math.max(0.05, Math.min(1, level));
        const h = clamped * 20;
        const x = idx * (120 / bars.length);
        const y = 12 - h / 2;
        return (
          <rect
            key={idx}
            x={x + 1}
            y={y}
            width={Math.max(2, 120 / bars.length - 2)}
            height={h}
            rx={1}
            fill={active ? '#2563eb' : '#94a3b8'}
          />
        );
      })}
    </svg>
  );
}
