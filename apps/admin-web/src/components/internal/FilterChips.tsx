'use client';

interface FilterChipsProps<T extends string> {
  readonly label: string;
  readonly options: ReadonlyArray<T>;
  readonly active: ReadonlySet<T>;
  readonly onToggle: (value: T) => void;
}

/**
 * Pill row used above tables for multi-select faceted filtering.
 * Active chips invert: solid signal-500 background, inactive use the
 * surface tone. All-empty Set means "no filter applied" — every row
 * passes through.
 */
export function FilterChips<T extends string>({
  label,
  options,
  active,
  onToggle,
}: FilterChipsProps<T>): JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-caption uppercase tracking-widest text-neutral-500">{label}</span>
      {options.map((opt) => {
        const isOn = active.has(opt);
        return (
          <button
            key={opt}
            type="button"
            onClick={() => onToggle(opt)}
            aria-pressed={isOn}
            className={`rounded-full border px-2.5 py-0.5 text-xs transition-colors ${
              isOn
                ? 'bg-signal-500 border-signal-500 text-primary-foreground'
                : 'bg-surface border-border text-neutral-300 hover:border-signal-500/40'
            }`}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}
