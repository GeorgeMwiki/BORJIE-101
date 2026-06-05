'use client';

import { useMemo } from 'react';

/**
 * SliceSelector — the implicit-made-explicit audit aid.
 *
 * The industry observer always reasons about a population slice. The
 * composer prepends this slice to every outgoing message as a grounding
 * hint, e.g. "(slice: TZ-GE · Grade-B · last 90 days)". That text is
 * visible to the user, captured in the thread transcript, and therefore
 * auditable by platform staff reviewing the conversation.
 */

export interface SliceState {
  readonly jurisdiction: string;
  readonly assetClass: string;
  readonly timeWindow: string;
}

export interface SliceOption {
  readonly value: string;
  readonly label: string;
}

export const DEFAULT_SLICE: SliceState = {
  jurisdiction: 'ALL',
  assetClass: 'ALL',
  timeWindow: '90d',
};

export const JURISDICTION_OPTIONS: ReadonlyArray<SliceOption> = [
  { value: 'ALL', label: 'All jurisdictions' },
  { value: 'TZ-GE', label: 'Tanzania · Geita (TZ-GE)' },
  { value: 'TZ-MW', label: 'Tanzania · Mwanza / Lake Zone (TZ-MW)' },
  { value: 'TZ-LI', label: 'Tanzania · Nachingwea / Lindi (TZ-LI)' },
  { value: 'TZ-MB', label: 'Tanzania · Mbeya / Chunya (TZ-MB)' },
  { value: 'TZ-RU', label: 'Tanzania · Songea / Ruvuma (TZ-RU)' },
  { value: 'KE-NB', label: 'Kenya · Nairobi (KE-NB)' },
  { value: 'UG-C', label: 'Uganda · Central (UG-C)' },
];

export const ASSET_CLASS_OPTIONS: ReadonlyArray<SliceOption> = [
  { value: 'ALL', label: 'All grades' },
  { value: 'Grade-A', label: 'Grade-A (high g/t)' },
  { value: 'Grade-B', label: 'Grade-B (mid g/t)' },
  { value: 'Grade-C', label: 'Grade-C (marginal g/t)' },
  { value: 'alluvial', label: 'Alluvial / placer' },
  { value: 'hard-rock', label: 'Hard-rock' },
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
    slice.assetClass === 'ALL' ? 'all grades' : slice.assetClass,
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
        aria-label="Asset grade"
        disabled={disabled}
        value={slice.assetClass}
        onChange={(e) =>
          onChange({ ...slice, assetClass: e.target.value })
        }
        className="rounded-md border border-border bg-surface px-2 py-1 text-xs text-foreground disabled:opacity-50"
      >
        {ASSET_CLASS_OPTIONS.map((o) => (
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
