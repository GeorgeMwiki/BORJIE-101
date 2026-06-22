'use client';

import { useState } from 'react';
import type { Scope } from '@/lib/internal/control-plane/api';
import { useLocale, pickByLocale, type Locale } from '@/lib/locale';

interface ScopeSelectorProps {
  readonly scope: Scope;
  readonly onChange: (scope: Scope) => void;
  readonly label?: string;
  readonly initialLocale?: Locale;
}

const S = {
  scope: { en: 'Scope', sw: 'Wigo' },
  global: { en: 'Global', sw: 'Kimataifa' },
  tenantOverride: { en: 'Tenant override', sw: 'Ubatilishaji wa mteja' },
  tenantId: { en: 'Tenant id', sw: 'Kitambulisho cha mteja' },
} as const;

/**
 * Global vs per-tenant scope picker. A control-plane scope is either the
 * platform-wide `global` default or a `tenant:<id>` override key — never a
 * tenant business-data row, only a STRING KEY naming which tenant an override
 * applies to. When the operator picks "Tenant override" we surface a tenant-id
 * input and compose the `tenant:<id>` key.
 */
export function ScopeSelector({
  scope,
  onChange,
  label,
  initialLocale,
}: ScopeSelectorProps): JSX.Element {
  const locale = useLocale(initialLocale);
  const isTenant = scope.startsWith('tenant:');
  const [tenantId, setTenantId] = useState(isTenant ? scope.slice('tenant:'.length) : '');
  const resolvedLabel = label ?? pickByLocale(locale, S.scope);

  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="text-xs uppercase tracking-wider text-muted-foreground">{resolvedLabel}</span>
      <div className="flex gap-1">
        <button
          type="button"
          onClick={() => onChange('global')}
          className={`rounded-md border px-3 py-1.5 text-xs ${
            scope === 'global'
              ? 'border-signal-500 bg-signal-500/10 text-signal-500'
              : 'border-border text-muted-foreground hover:bg-surface'
          }`}
        >
          {pickByLocale(locale, S.global)}
        </button>
        <button
          type="button"
          onClick={() => onChange(tenantId ? (`tenant:${tenantId}` as Scope) : 'global')}
          className={`rounded-md border px-3 py-1.5 text-xs ${
            isTenant
              ? 'border-signal-500 bg-signal-500/10 text-signal-500'
              : 'border-border text-muted-foreground hover:bg-surface'
          }`}
        >
          {pickByLocale(locale, S.tenantOverride)}
        </button>
      </div>
      {isTenant ? (
        <input
          type="text"
          value={tenantId}
          onChange={(e) => {
            const next = e.target.value.replace(/[^A-Za-z0-9_-]/g, '');
            setTenantId(next);
            onChange(next ? (`tenant:${next}` as Scope) : 'global');
          }}
          placeholder="tenant id"
          aria-label={pickByLocale(locale, S.tenantId)}
          className="w-48 rounded-md border border-border bg-surface-sunken px-3 py-1.5 font-mono text-xs text-foreground placeholder:text-muted-foreground focus:border-signal-500 focus:outline-none"
        />
      ) : null}
    </div>
  );
}
