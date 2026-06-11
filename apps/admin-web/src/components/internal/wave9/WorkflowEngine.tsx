'use client';

import { StubBadge } from '../StubBadge';
import {
  useMyWorkflowQueue,
  useFlowAutonomy,
} from '@/lib/internal/wave9/queries';

/**
 * Workflow engine & flow autonomy (I-W-26, read-first).
 *
 * Three read panels over the persistent four-eyes workflow engine:
 *   1. My queue          — the caller's open runs.
 *   2. Flow postures      — each flow's auto|gated decision.
 *   3. Pending postures   — flows awaiting the creation-time auto-vs-gated
 *                           confirmation.
 *
 * Starting / approving runs and flipping a posture are state-changing and
 * stay a follow-up that rides the durable-saga wave; the inviolable rails
 * still gate every action regardless of posture.
 */
export function WorkflowEngine(): JSX.Element {
  const queue = useMyWorkflowQueue();
  const postures = useFlowAutonomy(false);
  const pending = useFlowAutonomy(true);

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-foreground">My open runs</h2>
          <StubBadge tone="info">read-first</StubBadge>
        </div>
        {queue.isPending ? (
          <p className="text-sm text-neutral-500">Loading your queue…</p>
        ) : queue.isError ? (
          <p className="text-sm text-danger">{queue.error.message}</p>
        ) : (queue.data ?? []).length === 0 ? (
          <p className="text-sm text-neutral-400">No open workflow runs.</p>
        ) : (
          <div className="divide-y divide-border rounded-lg border border-border bg-surface">
            {(queue.data ?? []).map((run) => (
              <article key={run.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="font-mono text-xs text-neutral-500">{run.id}</p>
                  {run.definitionId ? (
                    <p className="text-sm text-foreground">{run.definitionId}</p>
                  ) : null}
                  {run.scope ? (
                    <p className="text-xs text-neutral-400">
                      {run.scope}
                      {run.scopeRef ? ` · ${run.scopeRef}` : ''}
                    </p>
                  ) : null}
                </div>
                {run.state || run.status ? (
                  <StubBadge tone="neutral">{run.state ?? run.status}</StubBadge>
                ) : null}
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-foreground">Flow postures</h2>
        {postures.isPending ? (
          <p className="text-sm text-neutral-500">Loading flow postures…</p>
        ) : postures.isError ? (
          <p className="text-sm text-danger">{postures.error.message}</p>
        ) : (postures.data ?? []).length === 0 ? (
          <p className="text-sm text-neutral-400">No flow postures set — every flow is GATED by default.</p>
        ) : (
          <div className="divide-y divide-border rounded-lg border border-border bg-surface">
            {(postures.data ?? []).map((pref) => (
              <article key={pref.flowId} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="font-mono text-xs text-neutral-500">{pref.flowId}</p>
                  {pref.riskCeiling ? (
                    <p className="text-xs text-neutral-400">ceiling: {pref.riskCeiling}</p>
                  ) : null}
                </div>
                <StubBadge tone={pref.posture === 'auto' ? 'success' : 'warn'}>
                  {pref.posture}
                </StubBadge>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-foreground">Pending auto-vs-gated confirmations</h2>
          <StubBadge tone="warn">trust-calibration</StubBadge>
        </div>
        {pending.isPending ? (
          <p className="text-sm text-neutral-500">Loading pending confirmations…</p>
        ) : pending.isError ? (
          <p className="text-sm text-danger">{pending.error.message}</p>
        ) : (pending.data ?? []).length === 0 ? (
          <p className="text-sm text-neutral-400">No flows awaiting confirmation.</p>
        ) : (
          <div className="divide-y divide-border rounded-lg border border-border bg-surface">
            {(pending.data ?? []).map((pref) => (
              <article key={pref.flowId} className="flex items-center justify-between gap-3 px-4 py-3">
                <p className="font-mono text-xs text-neutral-500">{pref.flowId}</p>
                <StubBadge tone="neutral">{pref.posture}</StubBadge>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
