'use client';

import type { CatalogModel } from '@/lib/internal/control-plane/api';

interface ModelSelectProps {
  readonly value: string;
  readonly models: ReadonlyArray<CatalogModel>;
  readonly onChange: (model: string) => void;
  readonly allowEmpty?: boolean;
  readonly emptyLabel?: string;
  readonly ariaLabel?: string;
}

/**
 * A model `<select>` hydrated from the live catalog, showing label + blended
 * cost so the operator picks with cost visible. Pure / controlled.
 */
export function ModelSelect({
  value,
  models,
  onChange,
  allowEmpty = false,
  emptyLabel = '— none —',
  ariaLabel = 'Model',
}: ModelSelectProps): JSX.Element {
  return (
    <select
      value={value}
      aria-label={ariaLabel}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-md border border-border bg-surface-sunken px-3 py-1.5 text-sm text-foreground focus:border-signal-500 focus:outline-none"
    >
      {allowEmpty ? <option value="">{emptyLabel}</option> : null}
      {models.map((m) => (
        <option key={m.model} value={m.model}>
          {m.label} · ${m.costPerMillionUsd.toFixed(2)}/1M
        </option>
      ))}
    </select>
  );
}
