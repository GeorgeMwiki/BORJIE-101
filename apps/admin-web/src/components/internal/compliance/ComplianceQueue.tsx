'use client';

import { useState } from 'react';
import { Button, Skeleton, EmptyState } from '@borjie/design-system';
import { StubBadge } from '../StubBadge';
import { DataSourceBadge } from '../DataSourceBadge';
import { Toast } from '../Toast';
import { useComplianceQueueQuery, useResolveCompliance } from '@/lib/internal/queries/compliance';
import type { ComplianceItem, ComplianceSeverity } from '@/lib/internal/types';
import { useLocale, pickByLocale, type Locale } from '@/lib/locale';
import { localizeApiError } from '@borjie/error-catalog';
import { localizeEnumLabel, SEVERITY_LABELS } from '@/lib/internal/enum-labels';

function severityTone(sev: ComplianceSeverity): 'danger' | 'warn' | 'neutral' {
  if (sev === 'High') return 'danger';
  if (sev === 'Medium') return 'warn';
  return 'neutral';
}

const S = {
  loading: { en: 'Loading queue…', sw: 'Inapakia foleni…' },
  emptyTitle: { en: 'Queue is empty', sw: 'Foleni iko tupu' },
  emptyBody: {
    en: 'Items awaiting human approval appear here. Nothing is pending.',
    sw: 'Vitu vinavyosubiri idhini ya binadamu huonekana hapa. Hakuna kinachosubiri.',
  },
  approve: { en: 'Approve', sw: 'Idhinisha' },
  reject: { en: 'Reject', sw: 'Kataa' },
  requestEvidence: { en: 'Request more evidence', sw: 'Omba ushahidi zaidi' },
  approved: { en: 'approved', sw: 'imeidhinishwa' },
  rejected: { en: 'rejected', sw: 'imekataliwa' },
  failed: { en: 'Failed', sw: 'Imeshindwa' },
  unknown: { en: 'unknown', sw: 'haijulikani' },
  hours: { en: 'h', sw: 'saa' },
} as const;

export function ComplianceQueue({
  initialLocale,
}: {
  readonly initialLocale?: Locale;
} = {}): JSX.Element {
  const locale = useLocale(initialLocale);
  const query = useComplianceQueueQuery();
  const resolve = useResolveCompliance();
  const [toast, setToast] = useState<string | null>(null);

  if (query.isPending) {
    return (
      <div className="space-y-2 rounded-lg border border-border bg-surface p-4">
        <Skeleton className="h-16 w-full rounded-md" />
        <Skeleton className="h-16 w-full rounded-md" />
      </div>
    );
  }
  if (query.isError) {
    return <p className="text-sm text-danger">{localizeApiError(query.error, locale)}</p>;
  }

  const rows = query.data?.rows ?? [];

  const decide = (item: ComplianceItem, decision: 'approve' | 'reject') => {
    resolve.mutate(
      { id: item.id, decision },
      {
        onSuccess: () =>
          setToast(
            `${item.tenant}: ${
              decision === 'approve'
                ? pickByLocale(locale, S.approved)
                : pickByLocale(locale, S.rejected)
            }`,
          ),
        onError: (err) =>
          setToast(
            `${pickByLocale(locale, S.failed)}: ${
              localizeApiError(err, locale)
            }`,
          ),
      }
    );
  };

  if (rows.length === 0) {
    return (
      <div className="space-y-4">
        <EmptyState
          title={pickByLocale(locale, S.emptyTitle)}
          description={pickByLocale(locale, S.emptyBody)}
        />
        <DataSourceBadge source={query.data?.source ?? 'mock'} locale={locale} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-surface divide-y divide-border">
        {rows.map((item) => (
          <article key={item.id} className="px-4 py-4">
            <div className="flex items-start justify-between gap-4 mb-1">
              <div>
                <p className="text-sm text-foreground">{item.tenant}</p>
                <p className="text-xs text-muted-foreground">{item.summary}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <StubBadge tone={severityTone(item.severity)}>
                  {localizeEnumLabel(SEVERITY_LABELS, item.severity, locale)}
                </StubBadge>
                <span className="text-xs text-muted-foreground">
                  {item.waitingHours}
                  {pickByLocale(locale, S.hours)}
                </span>
              </div>
            </div>
            <div className="flex gap-2 mt-3">
              <Button
                type="button"
                variant="success"
                size="sm"
                disabled={resolve.isPending}
                onClick={() => decide(item, 'approve')}
              >
                {pickByLocale(locale, S.approve)}
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={resolve.isPending}
                onClick={() => decide(item, 'reject')}
              >
                {pickByLocale(locale, S.reject)}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled
                title="Evidence-request workflow lands with the regulator-pipeline expansion (SCRUB-4: needs POST /compliance-queue/:id/request-evidence)"
              >
                {pickByLocale(locale, S.requestEvidence)}
              </Button>
            </div>
          </article>
        ))}
      </div>
      <DataSourceBadge source={query.data?.source ?? 'mock'} locale={locale} />
      <Toast message={toast} tone={resolve.isError ? 'danger' : 'success'} onDismiss={() => setToast(null)} />
    </div>
  );
}
