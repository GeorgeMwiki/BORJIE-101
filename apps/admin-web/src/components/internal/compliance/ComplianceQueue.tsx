'use client';

import { useState } from 'react';
import { Button } from '@borjie/design-system';
import { StubBadge } from '../StubBadge';
import { DataSourceBadge } from '../DataSourceBadge';
import { Toast } from '../Toast';
import { useComplianceQueueQuery, useResolveCompliance } from '@/lib/internal/queries/compliance';
import type { ComplianceItem, ComplianceSeverity } from '@/lib/internal/types';

function severityTone(sev: ComplianceSeverity): 'danger' | 'warn' | 'neutral' {
  if (sev === 'High') return 'danger';
  if (sev === 'Medium') return 'warn';
  return 'neutral';
}

export function ComplianceQueue(): JSX.Element {
  const query = useComplianceQueueQuery();
  const resolve = useResolveCompliance();
  const [toast, setToast] = useState<string | null>(null);

  if (query.isPending) return <p className="text-sm text-neutral-500">Loading queue…</p>;
  if (query.isError) return <p className="text-sm text-danger">{query.error.message}</p>;

  const rows = query.data?.rows ?? [];

  const decide = (item: ComplianceItem, decision: 'approve' | 'reject') => {
    resolve.mutate(
      { id: item.id, decision },
      {
        onSuccess: () => setToast(`${item.tenant}: ${decision}d`),
        onError: (err) => setToast(`Failed: ${err instanceof Error ? err.message : 'unknown'}`),
      }
    );
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-surface divide-y divide-border">
        {rows.length === 0 ? (
          <p className="px-4 py-6 text-xs text-neutral-500 text-center">Queue is empty.</p>
        ) : (
          rows.map((item) => (
            <article key={item.id} className="px-4 py-4">
              <div className="flex items-start justify-between gap-4 mb-1">
                <div>
                  <p className="text-sm text-foreground">{item.tenant}</p>
                  <p className="text-xs text-neutral-400">{item.summary}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <StubBadge tone={severityTone(item.severity)}>{item.severity}</StubBadge>
                  <span className="text-xs text-neutral-500">{item.waitingHours}h</span>
                </div>
              </div>
              <div className="flex gap-2 mt-3">
                <Button
                  type="button"
                  variant="success"
                  size="sm"
                  disabled={resolve.isPending}
                  onClick={() => decide(item, 'approve')}
                  className="bg-success/20 text-success hover:bg-success/30"
                >
                  Approve
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  disabled={resolve.isPending}
                  onClick={() => decide(item, 'reject')}
                  className="bg-danger/20 text-danger hover:bg-danger/30"
                >
                  Reject
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled
                  title="Evidence-request workflow lands with the regulator-pipeline expansion (SCRUB-4: needs POST /compliance-queue/:id/request-evidence)"
                  className="text-neutral-500 cursor-not-allowed"
                >
                  Request more evidence
                </Button>
              </div>
            </article>
          ))
        )}
      </div>
      <DataSourceBadge source={query.data?.source ?? 'mock'} />
      <Toast message={toast} tone={resolve.isError ? 'danger' : 'success'} onDismiss={() => setToast(null)} />
    </div>
  );
}
