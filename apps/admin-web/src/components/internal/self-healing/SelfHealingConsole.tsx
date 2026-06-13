'use client';

/**
 * Internal-admin Self-Healing Console (I-W-27).
 *
 * Lists every UI/wiring blocker the MAPE-K loop reported — needs-approval,
 * code-gated repair proposals AND auto-healed observations (crystallization
 * candidates). Each row shows the insight (why + blast radius) + the action
 * plan. The admin APPROVES a fix (accepts the repair plan) or DENIES it
 * (accepts the degrade). Auto-healed observations carry an "acknowledge"
 * (deny) so the queue can be cleared once reviewed.
 *
 * This is platform-internal: the owner never sees it. The customer was already
 * served (every blocker proceeds via degrade), so nothing here is an outage.
 */

import { useState } from 'react';
import { StubBadge } from '@/components/internal/StubBadge';
import { Toast } from '@/components/internal/Toast';
import {
  useSelfHealingQueueQuery,
  useDecideRepairProposal,
  type RepairProposalView,
} from '@/lib/internal/queries/self-healing';

function kindTone(p: RepairProposalView): 'danger' | 'warn' | 'info' {
  if (p.needsApproval) return 'danger';
  if (p.repairClass.startsWith('escalate')) return 'warn';
  return 'info';
}

function statusLabel(p: RepairProposalView): string {
  if (p.needsApproval) return 'Needs approval';
  if (p.status === 'auto-healed') return 'Auto-healed · observation';
  return p.status;
}

export function SelfHealingConsole(): JSX.Element {
  const query = useSelfHealingQueueQuery();
  const decide = useDecideRepairProposal();
  const [toast, setToast] = useState<string | null>(null);

  if (query.isPending) {
    return <p className="text-sm text-neutral-500">Loading self-healing queue…</p>;
  }
  if (query.isError) {
    return <p className="text-sm text-danger">{query.error.message}</p>;
  }

  const rows = query.data?.rows ?? [];

  const act = (p: RepairProposalView, decision: 'approve' | 'deny') => {
    decide.mutate(
      { id: p.id, decision },
      {
        onSuccess: () =>
          setToast(`${p.title}: ${decision === 'approve' ? 'approved' : 'dismissed'}`),
        onError: (err) =>
          setToast(`Failed: ${err instanceof Error ? err.message : 'unknown'}`),
      },
    );
  };

  return (
    <div className="space-y-4">
      <p className="text-xs text-neutral-400">
        Blockers the platform healed or escalated. The customer was always served
        (every blocker degrades, never breaks). Approve a fix to accept its repair
        plan; dismiss to accept the degrade. {rows.length} open.
      </p>

      <div className="divide-y divide-border rounded-lg border border-border bg-surface">
        {rows.length === 0 ? (
          <p className="px-4 py-6 text-center text-xs text-neutral-500">
            Queue is empty — nothing to heal.
          </p>
        ) : (
          rows.map((p) => (
            <article key={p.id} className="px-4 py-4">
              <div className="mb-1 flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="truncate text-sm text-foreground">{p.title}</p>
                  <p className="mt-0.5 font-mono text-[11px] text-neutral-400">
                    {p.locus}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <StubBadge tone={kindTone(p)}>{statusLabel(p)}</StubBadge>
                  {p.occurrenceCount > 1 ? (
                    <span className="text-xs text-neutral-500">
                      ×{p.occurrenceCount}
                    </span>
                  ) : null}
                </div>
              </div>

              <p className="mt-2 text-xs text-neutral-300">{p.insight}</p>

              {p.actionPlan.length > 0 ? (
                <ol className="mt-2 list-decimal space-y-0.5 pl-5 text-xs text-neutral-400">
                  {p.actionPlan.map((step, i) => (
                    <li key={i}>{step}</li>
                  ))}
                </ol>
              ) : null}

              <div className="mt-2 text-[11px] text-neutral-500">
                <span className="font-medium text-neutral-400">Suggested fix:</span>{' '}
                {p.suggestedFix}
                {p.tenantId ? (
                  <>
                    {' · '}
                    <span className="font-medium text-neutral-400">
                      first-seen tenant:
                    </span>{' '}
                    {p.tenantId}
                  </>
                ) : null}
              </div>

              <div className="mt-3 flex gap-2">
                {p.needsApproval ? (
                  <button
                    type="button"
                    disabled={decide.isPending}
                    onClick={() => act(p, 'approve')}
                    className="rounded-md bg-success/20 px-3 py-1 text-xs font-medium text-success hover:bg-success/30 disabled:opacity-50"
                  >
                    Approve fix
                  </button>
                ) : null}
                <button
                  type="button"
                  disabled={decide.isPending}
                  onClick={() => act(p, 'deny')}
                  className="rounded-md bg-danger/20 px-3 py-1 text-xs font-medium text-danger hover:bg-danger/30 disabled:opacity-50"
                >
                  {p.needsApproval ? 'Deny (accept degrade)' : 'Dismiss'}
                </button>
              </div>
            </article>
          ))
        )}
      </div>

      <Toast
        message={toast}
        tone={decide.isError ? 'danger' : 'success'}
        onDismiss={() => setToast(null)}
      />
    </div>
  );
}
