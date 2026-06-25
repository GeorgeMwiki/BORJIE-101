'use client';

import { useMemo, useState } from 'react';
import { Skeleton, EmptyState } from '@borjie/design-system';
import { DecisionFilters, type DecisionFiltersState } from './DecisionFilters';
import { VirtualList } from './VirtualList';
import { DataSourceBadge } from '../DataSourceBadge';
import { StubBadge } from '../StubBadge';
import { useDecisionLogQuery } from '@/lib/internal/queries/decision-log';
import { useTenantsQuery } from '@/lib/internal/queries/tenants';
import type { DecisionLogRow } from '@/lib/internal/types';
import { useLocale, pickByLocale, type Locale } from '@/lib/locale';
import { localizeApiError } from '@borjie/error-catalog';

const INITIAL: DecisionFiltersState = { tenantId: '', juniorId: '', from: '', to: '' };

function confidenceTone(c: number): 'success' | 'warn' | 'danger' {
  if (c >= 0.8) return 'success';
  if (c >= 0.6) return 'warn';
  return 'danger';
}

const S = {
  loading: { en: 'Loading decisions…', sw: 'Inapakia maamuzi…' },
  inRange: { en: 'decisions in range', sw: 'maamuzi katika kipindi' },
  emptyTitle: { en: 'No decisions in range', sw: 'Hakuna maamuzi katika kipindi' },
  emptyBody: {
    en: 'Adjust the filters or date range to see logged decisions.',
    sw: 'Rekebisha vichujio au kipindi cha tarehe ili kuona maamuzi yaliyorekodiwa.',
  },
  evidence: { en: 'evidence', sw: 'ushahidi' },
  listLabel: { en: 'Decision log', sw: 'Kumbukumbu ya maamuzi' },
} as const;

export function DecisionLogAuditor({
  initialLocale,
}: {
  readonly initialLocale?: Locale;
} = {}): JSX.Element {
  const locale = useLocale(initialLocale);
  const query = useDecisionLogQuery();
  const tenantsQuery = useTenantsQuery();
  const [filters, setFilters] = useState<DecisionFiltersState>(INITIAL);

  const rows = query.data?.rows ?? [];
  const tenants = tenantsQuery.data?.rows ?? [];

  const filtered = useMemo(() => {
    const fromMs = filters.from ? Date.parse(filters.from) : Number.NEGATIVE_INFINITY;
    const toMs = filters.to ? Date.parse(filters.to) + 24 * 60 * 60 * 1000 : Number.POSITIVE_INFINITY;
    return rows.filter((row) => {
      if (filters.tenantId && row.tenantId !== filters.tenantId) return false;
      if (filters.juniorId && row.juniorId !== filters.juniorId) return false;
      const at = Date.parse(row.at);
      if (at < fromMs || at > toMs) return false;
      return true;
    });
  }, [rows, filters]);

  // Juniors filter values are derived from the rows themselves until the
  // gateway exposes a juniors registry — every junior that appears in the
  // current decision-log payload is a valid filter target.
  const juniors = useMemo(() => {
    const seen = new Map<string, string>();
    for (const row of rows) {
      if (!seen.has(row.juniorId)) seen.set(row.juniorId, row.junior);
    }
    return Array.from(seen.entries()).map(([id, name]) => ({ id, name }));
  }, [rows]);

  if (query.isPending) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-20 w-full rounded-lg" />
        <Skeleton className="h-[520px] w-full rounded-lg" />
      </div>
    );
  }
  if (query.isError) {
    return <p className="text-sm text-danger">{localizeApiError(query.error, locale)}</p>;
  }

  return (
    <div className="space-y-4">
      <DecisionFilters
        value={filters}
        onChange={setFilters}
        tenants={tenants.map((t) => ({ id: t.id, name: t.name }))}
        juniors={juniors}
        locale={locale}
      />

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {filtered.length.toLocaleString()} {pickByLocale(locale, S.inRange)}
        </span>
        <DataSourceBadge source={query.data?.source ?? 'live'} locale={locale} />
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title={pickByLocale(locale, S.emptyTitle)}
          description={pickByLocale(locale, S.emptyBody)}
        />
      ) : (
        <VirtualList<DecisionLogRow>
          items={filtered}
          rowHeight={64}
          height={520}
          ariaLabel={pickByLocale(locale, S.listLabel)}
          render={(row) => (
            <div className="px-4 py-2 flex items-start justify-between gap-4 h-full">
              <div className="min-w-0 flex-1">
                <p className="text-sm text-foreground truncate">{row.decision}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {row.tenant} · {row.junior} · {row.mode} · {row.evidenceIds.length}{' '}
                  {pickByLocale(locale, S.evidence)}
                </p>
              </div>
              <div className="flex flex-col items-end gap-1 shrink-0">
                <span className="text-xs text-muted-foreground tabular-nums">
                  {row.at.replace('T', ' ').slice(0, 16)}
                </span>
                <StubBadge tone={confidenceTone(row.confidence)}>
                  {(row.confidence * 100).toFixed(0)}%
                </StubBadge>
              </div>
            </div>
          )}
        />
      )}
    </div>
  );
}
