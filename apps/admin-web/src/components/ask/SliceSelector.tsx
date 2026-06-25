'use client';

import { useMemo } from 'react';

import { pickByLocale, useLocale, type Locale } from '@/lib/locale';

/**
 * SliceSelector — the implicit-made-explicit audit aid.
 *
 * The industry observer always reasons about a population slice. The
 * composer prepends this slice to every outgoing message as a grounding
 * hint, e.g. "(slice: TZ-GE · Grade-B · last 90 days)". That text is
 * visible to the user, captured in the thread transcript, and therefore
 * auditable by platform staff reviewing the conversation. The hint and
 * every control label resolve to the active locale (zero-mix canon).
 */

export interface SliceState {
  readonly jurisdiction: string;
  readonly assetClass: string;
  readonly timeWindow: string;
}

export interface SliceOption {
  readonly value: string;
  readonly label: { readonly en: string; readonly sw: string };
}

export const DEFAULT_SLICE: SliceState = {
  jurisdiction: 'ALL',
  assetClass: 'ALL',
  timeWindow: '90d',
};

export const JURISDICTION_OPTIONS: ReadonlyArray<SliceOption> = [
  { value: 'ALL', label: { en: 'All jurisdictions', sw: 'Mamlaka zote' } },
  { value: 'TZ-GE', label: { en: 'Tanzania · Geita (TZ-GE)', sw: 'Tanzania · Geita (TZ-GE)' } },
  { value: 'TZ-MW', label: { en: 'Tanzania · Mwanza / Lake Zone (TZ-MW)', sw: 'Tanzania · Mwanza / Kanda ya Ziwa (TZ-MW)' } },
  { value: 'TZ-LI', label: { en: 'Tanzania · Nachingwea / Lindi (TZ-LI)', sw: 'Tanzania · Nachingwea / Lindi (TZ-LI)' } },
  { value: 'TZ-MB', label: { en: 'Tanzania · Mbeya / Chunya (TZ-MB)', sw: 'Tanzania · Mbeya / Chunya (TZ-MB)' } },
  { value: 'TZ-RU', label: { en: 'Tanzania · Songea / Ruvuma (TZ-RU)', sw: 'Tanzania · Songea / Ruvuma (TZ-RU)' } },
  { value: 'KE-NB', label: { en: 'Kenya · Nairobi (KE-NB)', sw: 'Kenya · Nairobi (KE-NB)' } },
  { value: 'UG-C', label: { en: 'Uganda · Central (UG-C)', sw: 'Uganda · Kati (UG-C)' } },
];

export const ASSET_CLASS_OPTIONS: ReadonlyArray<SliceOption> = [
  { value: 'ALL', label: { en: 'All grades', sw: 'Madaraja yote' } },
  { value: 'Grade-A', label: { en: 'Grade-A (high g/t)', sw: 'Daraja-A (g/t juu)' } },
  { value: 'Grade-B', label: { en: 'Grade-B (mid g/t)', sw: 'Daraja-B (g/t wastani)' } },
  { value: 'Grade-C', label: { en: 'Grade-C (marginal g/t)', sw: 'Daraja-C (g/t pembezoni)' } },
  { value: 'alluvial', label: { en: 'Alluvial / placer', sw: 'Mchanga / placer' } },
  { value: 'hard-rock', label: { en: 'Hard-rock', sw: 'Mwamba-mgumu' } },
];

export const TIME_WINDOW_OPTIONS: ReadonlyArray<SliceOption> = [
  { value: '7d', label: { en: 'Last 7 days', sw: 'Siku 7 zilizopita' } },
  { value: '30d', label: { en: 'Last 30 days', sw: 'Siku 30 zilizopita' } },
  { value: '90d', label: { en: 'Last 90 days', sw: 'Siku 90 zilizopita' } },
  { value: '180d', label: { en: 'Last 180 days', sw: 'Siku 180 zilizopita' } },
  { value: '365d', label: { en: 'Last 365 days', sw: 'Siku 365 zilizopita' } },
];

export function formatSliceHint(slice: SliceState, locale: Locale): string {
  const parts: string[] = [];
  parts.push(
    slice.jurisdiction === 'ALL'
      ? pickByLocale(locale, { en: 'all jurisdictions', sw: 'mamlaka zote' })
      : slice.jurisdiction,
  );
  parts.push(
    slice.assetClass === 'ALL'
      ? pickByLocale(locale, { en: 'all grades', sw: 'madaraja yote' })
      : slice.assetClass,
  );
  const time = TIME_WINDOW_OPTIONS.find((o) => o.value === slice.timeWindow);
  parts.push(
    time ? pickByLocale(locale, time.label).toLowerCase() : slice.timeWindow,
  );
  const sliceWord = pickByLocale(locale, { en: 'slice', sw: 'kipande' });
  return `(${sliceWord}: ${parts.join(' · ')})`;
}

interface SliceSelectorProps {
  readonly slice: SliceState;
  readonly onChange: (next: SliceState) => void;
  readonly disabled?: boolean;
}

export function SliceSelector({ slice, onChange, disabled }: SliceSelectorProps) {
  const locale = useLocale();
  const hint = useMemo(() => formatSliceHint(slice, locale), [slice, locale]);

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="uppercase tracking-wider text-neutral-500">
        {pickByLocale(locale, { en: 'Slice', sw: 'Kipande' })}
      </span>

      <select
        aria-label={pickByLocale(locale, {
          en: 'Jurisdiction',
          sw: 'Mamlaka',
        })}
        disabled={disabled}
        value={slice.jurisdiction}
        onChange={(e) =>
          onChange({ ...slice, jurisdiction: e.target.value })
        }
        className="rounded-md border border-border bg-surface px-2 py-1 text-xs text-foreground disabled:opacity-50"
      >
        {JURISDICTION_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {pickByLocale(locale, o.label)}
          </option>
        ))}
      </select>

      <select
        aria-label={pickByLocale(locale, {
          en: 'Asset grade',
          sw: 'Daraja la mali',
        })}
        disabled={disabled}
        value={slice.assetClass}
        onChange={(e) =>
          onChange({ ...slice, assetClass: e.target.value })
        }
        className="rounded-md border border-border bg-surface px-2 py-1 text-xs text-foreground disabled:opacity-50"
      >
        {ASSET_CLASS_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {pickByLocale(locale, o.label)}
          </option>
        ))}
      </select>

      <select
        aria-label={pickByLocale(locale, {
          en: 'Time window',
          sw: 'Dirisha la wakati',
        })}
        disabled={disabled}
        value={slice.timeWindow}
        onChange={(e) => onChange({ ...slice, timeWindow: e.target.value })}
        className="rounded-md border border-border bg-surface px-2 py-1 text-xs text-foreground disabled:opacity-50"
      >
        {TIME_WINDOW_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {pickByLocale(locale, o.label)}
          </option>
        ))}
      </select>

      <span
        className="text-neutral-500 ml-1"
        title={pickByLocale(locale, {
          en: 'Hint prepended to every outgoing message',
          sw: 'Dokezo linaloongezwa mwanzoni mwa kila ujumbe unaotumwa',
        })}
      >
        {hint}
      </span>
    </div>
  );
}
