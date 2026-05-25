'use client';

interface TimeTravelSliderProps {
  readonly asOf: string;
  readonly onChange: (asOf: string) => void;
}

/**
 * Time-travel slider above the graph. Lets the owner roll the
 * as-of-date back and forward over a 24-month window so they can see
 * how the LMBM looked when (e.g.) a specific licence was granted.
 */
export function TimeTravelSlider({ asOf, onChange }: TimeTravelSliderProps) {
  const today = new Date();
  const minDate = new Date(today);
  minDate.setFullYear(today.getFullYear() - 1);
  const maxDate = new Date(today);
  maxDate.setFullYear(today.getFullYear() + 1);
  const current = new Date(asOf);
  const totalDays =
    Math.round((maxDate.getTime() - minDate.getTime()) / (1000 * 60 * 60 * 24));
  const currentDay = Math.round(
    (current.getTime() - minDate.getTime()) / (1000 * 60 * 60 * 24),
  );
  return (
    <div className="flex items-center gap-3 rounded-md border border-border bg-surface/40 px-4 py-3 text-xs text-neutral-300">
      <span className="uppercase tracking-wide text-neutral-500">As-of</span>
      <input
        type="range"
        min={0}
        max={totalDays}
        value={Math.max(0, Math.min(totalDays, currentDay))}
        onChange={(e) => {
          const day = Number(e.target.value);
          const next = new Date(minDate);
          next.setDate(next.getDate() + day);
          onChange(next.toISOString().slice(0, 10));
        }}
        className="flex-1 accent-warning"
      />
      <span className="font-mono text-foreground">{asOf}</span>
    </div>
  );
}
