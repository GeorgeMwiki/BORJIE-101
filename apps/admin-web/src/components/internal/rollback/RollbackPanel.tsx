'use client';

import { useState } from 'react';
import { ConfirmModal } from '../ConfirmModal';
import { DataSourceBadge } from '../DataSourceBadge';
import { StubBadge } from '../StubBadge';
import { Toast } from '../Toast';
import { usePromotionsQuery, useRevertPromotion } from '@/lib/internal/queries/rollback';
import type { PromotionRow } from '@/lib/mocks/types';

export function RollbackPanel(): JSX.Element {
  const query = usePromotionsQuery();
  const revert = useRevertPromotion();
  const [target, setTarget] = useState<PromotionRow | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  if (query.isPending) return <p className="text-sm text-neutral-500">Loading promotions…</p>;
  if (query.isError) return <p className="text-sm text-danger">{query.error.message}</p>;

  const rows = query.data?.rows ?? [];

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-surface divide-y divide-border">
        {rows.map((row) => (
          <div key={row.id} className="px-4 py-4 flex items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <StubBadge tone="info">{row.kind}</StubBadge>
                <span className="text-xs text-neutral-500 tabular-nums">
                  {row.promotedAt.replace('T', ' ').slice(0, 16)}
                </span>
                <span className="text-xs text-neutral-500">by {row.promotedBy}</span>
              </div>
              <p className="text-sm text-foreground">{row.subject}</p>
            </div>
            <button
              type="button"
              disabled={!row.canRevert || revert.isPending}
              onClick={() => setTarget(row)}
              className="rounded-md border border-danger/40 bg-danger/10 px-3 py-1.5 text-xs font-medium text-danger hover:bg-danger/20 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {row.canRevert ? 'Revert now' : 'Window closed'}
            </button>
          </div>
        ))}
      </div>

      <DataSourceBadge source={query.data?.source ?? 'mock'} />

      <ConfirmModal
        open={Boolean(target)}
        tone="danger"
        title="Revert promotion"
        body={
          target ? (
            <>
              Roll back <strong className="text-foreground">{target.subject}</strong>? This will emit an audit event and
              notify the platform channel.
            </>
          ) : null
        }
        confirmLabel="Revert"
        busy={revert.isPending}
        onCancel={() => setTarget(null)}
        onConfirm={() => {
          if (!target) return;
          revert.mutate(target.id, {
            onSuccess: () => {
              setToast(`${target.subject} reverted`);
              setTarget(null);
            },
            onError: (err) => setToast(`Failed: ${err instanceof Error ? err.message : 'unknown'}`),
          });
        }}
      />
      <Toast message={toast} tone={revert.isError ? 'danger' : 'success'} onDismiss={() => setToast(null)} />
    </div>
  );
}
