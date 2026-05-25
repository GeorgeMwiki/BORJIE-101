'use client';

import { useMemo } from 'react';

/**
 * SliceSelector — the implicit-made-explicit audit aid.
 *
 * The industry observer always reasons about a population slice. The
 * composer prepends this slice to every outgoing message as a grounding
 * hint, e.g. "(slice: KE-30 · Class-B · last 90 days)". That text is
 * visible to the user, captured in the thread transcript, and therefore
 * auditable by platform staff reviewing the conversation.
 */

export interface SliceState {
  readonly jurisdiction: string;
  readonly propertyClass: string;
  readonly timeWindow: string;
}

export interface SliceOption {
  readonly value: string;
  readonly label: string;
}

export const DEFAULT_SLICE: SliceState = {
  jurisdiction: 'ALL',
  propertyClass: 'ALL',
  timeWindow: '90d',
};

export const JURISDICTION_OPTIONS: ReadonlyArray<SliceOption> = [
  { value: 'ALL', label: 'All jurisdictions' },
  { value: 'KE-30', label: 'Kenya · Nairobi (KE-30)' },
  { value: 'KE-47', label: 'Kenya · Kisumu (KE-47)' },
  { value: 'KE-36', label: 'Kenya · Mombasa (KE-36)' },
  { value: 'UG-C', label: 'Uganda · Central (UG-C)' },
  { value: 'TZ-02', label: 'Tanzania · Dar es Salaam (TZ-02)' },
  { value: 'RW-01', label: 'Rwanda · Kigali (RW-01)' },
  { value: 'ZA-GP', label: 'South Africa · Gauteng (ZA-GP)' },
];

export const PROPERTY_CLASS_OPTIONS: ReadonlyArray<SliceOption> = [
  { value: 'ALL', label: 'All classes' },
  { value: 'Class-A', label: 'Class-A (premium)' },
  { value: 'Class-B', label: 'Class-B (mid-market)' },
  { value: 'Class-C', label: 'Class-C (affordable)' },
  { value: 'commercial', label: 'Commercial' },
  { value: 'mixed-use', label: 'Mixed-use' },
];

export const TIME_WINDOW_OPTIONS: ReadonlyArray<SliceOption> = [
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
  { value: '180d', label: 'Last 180 days' },
  { value: '365d', label: 'Last 365 days' },
];

export function formatSliceHint(slice: SliceState): string {
  const parts: string[] = [];
  parts.push(
    slice.jurisdiction === 'ALL' ? 'all jurisdictions' : slice.jurisdiction,
  );
  parts.push(
    slice.propertyClass === 'ALL' ? 'all classes' : slice.propertyClass,
  );
  const time = TIME_WINDOW_OPTIONS.find((o) => o.value === slice.timeWindow);
  parts.push(time ? time.label.toLowerCase() : slice.timeWindow);
  return `(slice: ${parts.join(' · ')})`;
}

interface SliceSelectorProps {
  readonly slice: SliceState;
  readonly onChange: (next: SliceState) => void;
  readonly disabled?: boolean;
}

export function SliceSelector({ slice, onChange, disabled }: SliceSelectorProps) {
  const hint = useMemo(() => formatSliceHint(slice), [slice]);

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="uppercase tracking-wider text-neutral-500">Slice</span>

      <select
        aria-label="Jurisdiction"
        disabled={disabled}
        value={slice.jurisdiction}
        onChange={(e) =>
          onChange({ ...slice, jurisdiction: e.target.value })
        }
        className="rounded-md border border-border bg-surface px-2 py-1 text-xs text-foreground disabled:opacity-50"
      >
        {JURISDICTION_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>

      <select
        aria-label="Property class"
        disabled={disabled}
        value={slice.propertyClass}
        onChange={(e) =>
          onChange({ ...slice, propertyClass: e.target.value })
        }
        className="rounded-md border border-border bg-surface px-2 py-1 text-xs text-foreground disabled:opacity-50"
      >
        {PROPERTY_CLASS_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>

      <select
        aria-label="Time window"
        disabled={disabled}
        value={slice.timeWindow}
        onChange={(e) => onChange({ ...slice, timeWindow: e.target.value })}
        className="rounded-md border border-border bg-surface px-2 py-1 text-xs text-foreground disabled:opacity-50"
      >
        {TIME_WINDOW_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>

      <span className="text-neutral-500 ml-1" title="Hint prepended to every outgoing message">
        {hint}
      </span>
    </div>
  );
}
