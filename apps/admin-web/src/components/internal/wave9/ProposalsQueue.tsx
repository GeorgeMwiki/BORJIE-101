'use client';

import { useState } from 'react';
import { StubBadge } from '../StubBadge';
import { Toast } from '../Toast';
import {
  usePendingProposals,
  useApproveProposal,
  useDeclineProposal,
} from '@/lib/internal/wave9/queries';
import type { Proposal } from '@/lib/internal/wave9/api';

/**
 * Proposals approval queue (I-W-22).
 *
 * Lists `pending_hitl` brain↔tab module-update proposals and lets a second
 * operator approve (with an approver tier) or decline (with a reason). The
 * gateway runs the REAL state transition + four-eye / approver-tier rules;
 * this surface only renders the queue and posts the decisions.
 */
export function ProposalsQueue(): JSX.Element {
  const query = usePendingProposals();
  const approve = useApproveProposal();
  const decline = useDeclineProposal();
  const [toast, setToast] = useState<string | null>(null);
  const [tone, setTone] = useState<'success' | 'danger'>('success');
  const [tierById, setTierById] = useState<Record<string, number>>({});
  const [reasonById, setReasonById] = useState<Record<string, string>>({});

  function announce(message: string, nextTone: 'success' | 'danger') {
    setTone(nextTone);
    setToast(message);
  }

  function onApprove(p: Proposal) {
    const tier = tierById[p.id] ?? 1;
    approve.mutate(
      { id: p.id, approverTier: tier },
      {
        onSuccess: (res) => announce(`Proposal ${res.id.slice(0, 8)}… → ${res.status}`, 'success'),
        onError: (err) => announce(`Approve failed: ${err.message}`, 'danger'),
      },
    );
  }

  function onDecline(p: Proposal) {
    const reason = (reasonById[p.id] ?? '').trim();
    if (reason.length < 1) {
      announce('Enter a decline reason first.', 'danger');
      return;
    }
    decline.mutate(
      { id: p.id, reason },
      {
        onSuccess: (res) => announce(`Proposal ${res.id.slice(0, 8)}… → ${res.status}`, 'success'),
        onError: (err) => announce(`Decline failed: ${err.message}`, 'danger'),
      },
    );
  }

  if (query.isPending) {
    return <p className="text-sm text-neutral-500">Loading pending proposals…</p>;
  }
  if (query.isError) {
    return <p className="text-sm text-danger">{query.error.message}</p>;
  }

  const items = query.data ?? [];
  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-surface px-4 py-8 text-center">
        <p className="text-sm text-neutral-400">No proposals awaiting human review.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <StubBadge tone="info">{items.length} pending · four-eye enforced upstream</StubBadge>
      </div>

      <div className="divide-y divide-border rounded-lg border border-border bg-surface">
        {items.map((p) => {
          const busy = approve.isPending || decline.isPending;
          return (
            <article key={p.id} className="flex flex-col gap-3 px-4 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm text-foreground">{p.action ?? 'update'}</p>
                    {p.moduleTemplateId ? (
                      <span className="font-mono text-xs text-neutral-500">
                        {p.moduleTemplateId}
                      </span>
                    ) : null}
                    {p.hitlRequired ? <StubBadge tone="warn">HITL</StubBadge> : null}
                  </div>
                  <p className="mt-0.5 font-mono text-xs text-neutral-500">{p.id}</p>
                  {p.personaId ? (
                    <p className="mt-0.5 text-xs text-neutral-400">persona: {p.personaId}</p>
                  ) : null}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1 text-right">
                  {typeof p.confidence === 'number' ? (
                    <StubBadge tone="neutral">conf {Math.round(p.confidence * 100)}%</StubBadge>
                  ) : null}
                  {p.priority !== null && p.priority !== undefined ? (
                    <span className="text-xs text-neutral-500">priority {String(p.priority)}</span>
                  ) : null}
                </div>
              </div>

              <div className="flex flex-wrap items-end gap-3">
                <label className="block">
                  <span className="mb-1 block text-xs uppercase tracking-wider text-neutral-500">
                    Approver tier
                  </span>
                  <input
                    type="number"
                    min={1}
                    max={5}
                    value={tierById[p.id] ?? 1}
                    onChange={(e) =>
                      setTierById((prev) => ({
                        ...prev,
                        [p.id]: Math.max(1, Math.min(5, Number(e.target.value) || 1)),
                      }))
                    }
                    className="w-20 rounded-md border border-border bg-surface-sunken px-2 py-1 text-sm text-foreground focus:border-signal-500 focus:outline-none"
                  />
                </label>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onApprove(p)}
                  className="rounded-md border border-border px-3 py-1.5 text-xs text-success hover:bg-surface-sunken disabled:opacity-40"
                >
                  Approve
                </button>

                <label className="block flex-1 min-w-[12rem]">
                  <span className="mb-1 block text-xs uppercase tracking-wider text-neutral-500">
                    Decline reason
                  </span>
                  <input
                    type="text"
                    value={reasonById[p.id] ?? ''}
                    onChange={(e) =>
                      setReasonById((prev) => ({ ...prev, [p.id]: e.target.value }))
                    }
                    placeholder="Why is this being declined?"
                    className="w-full rounded-md border border-border bg-surface-sunken px-3 py-1.5 text-sm text-foreground placeholder:text-neutral-600 focus:border-signal-500 focus:outline-none"
                  />
                </label>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onDecline(p)}
                  className="rounded-md border border-border px-3 py-1.5 text-xs text-warning hover:bg-surface-sunken disabled:opacity-40"
                >
                  Decline
                </button>
              </div>
            </article>
          );
        })}
      </div>

      <Toast message={toast} tone={tone} onDismiss={() => setToast(null)} />
    </div>
  );
}
