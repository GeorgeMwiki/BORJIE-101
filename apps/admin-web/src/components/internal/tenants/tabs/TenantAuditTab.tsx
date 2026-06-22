'use client';

import { useMemo } from 'react';
import { Skeleton, Alert } from '@borjie/design-system';
import { useAuditLogQuery } from '@/lib/internal/queries/audit-log';
import { useLocale, pickByLocale, type Locale } from '@/lib/locale';

interface TenantAuditTabProps {
  readonly tenantId: string;
  readonly initialLocale?: Locale;
}

const S = {
  loading: { en: 'Loading audit events…', sw: 'Inapakia matukio ya ukaguzi…' },
  unavailable: { en: 'Audit log unavailable', sw: 'Daftari la ukaguzi halipatikani' },
  empty: { en: 'No audit events for this tenant.', sw: 'Hakuna matukio ya ukaguzi kwa mteja huyu.' },
} as const;

export function TenantAuditTab({ tenantId, initialLocale }: TenantAuditTabProps): JSX.Element {
  const locale = useLocale(initialLocale);
  const { data, isPending, isError, error } = useAuditLogQuery();
  const rows = useMemo(
    () => (data?.rows ?? []).filter((r) => r.tenantId === tenantId).slice(0, 30),
    [data, tenantId],
  );

  if (isPending) {
    return (
      <Skeleton
        className="h-48 w-full rounded-lg"
        aria-label={pickByLocale(locale, S.loading)}
      />
    );
  }
  if (isError) {
    return (
      <Alert variant="error" title={pickByLocale(locale, S.unavailable)}>
        {error.message}
      </Alert>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-surface divide-y divide-border">
      {rows.length === 0 ? (
        <p className="px-4 py-6 text-xs text-muted-foreground">
          {pickByLocale(locale, S.empty)}
        </p>
      ) : (
        rows.map((evt) => (
          <div key={evt.id} className="px-4 py-3 font-mono text-xs flex items-center gap-3">
            <span className="text-muted-foreground tabular-nums shrink-0">
              {evt.at.replace('T', ' ').slice(0, 16)}
            </span>
            <span className="text-signal-500 shrink-0 w-24 truncate">{evt.actor}</span>
            <span className="text-foreground truncate">
              {evt.action}
              {evt.target ? ` — ${evt.target}` : ''}
            </span>
          </div>
        ))
      )}
    </div>
  );
}
