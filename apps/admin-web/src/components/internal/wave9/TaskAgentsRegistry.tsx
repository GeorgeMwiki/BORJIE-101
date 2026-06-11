'use client';

import { useState } from 'react';
import { StubBadge } from '../StubBadge';
import { Toast } from '../Toast';
import { useTaskAgents, useRunTaskAgent } from '@/lib/internal/wave9/queries';
import type { TaskAgent } from '@/lib/internal/wave9/api';

/**
 * Task-Agents registry (I-W-24).
 *
 * Lists the uniform registry of narrow-scope task agents (id, trigger,
 * guardrails) and lets an operator manually trigger one. The payload is a
 * free-form JSON object; the gateway validates it against the agent's own
 * zod schema and runs the executor (503 when the executor isn't wired).
 */
export function TaskAgentsRegistry(): JSX.Element {
  const query = useTaskAgents();
  const run = useRunTaskAgent();
  const [toast, setToast] = useState<string | null>(null);
  const [tone, setTone] = useState<'success' | 'danger'>('success');
  const [payloadById, setPayloadById] = useState<Record<string, string>>({});

  function announce(message: string, nextTone: 'success' | 'danger') {
    setTone(nextTone);
    setToast(message);
  }

  function onRun(agent: TaskAgent) {
    const raw = (payloadById[agent.id] ?? '').trim();
    let payload: Record<string, unknown> = {};
    if (raw.length > 0) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          payload = parsed as Record<string, unknown>;
        } else {
          announce('Payload must be a JSON object.', 'danger');
          return;
        }
      } catch {
        announce('Payload is not valid JSON.', 'danger');
        return;
      }
    }
    run.mutate(
      { id: agent.id, payload },
      {
        onSuccess: () => announce(`${agent.id} triggered`, 'success'),
        onError: (err) => announce(`Run failed: ${err.message}`, 'danger'),
      },
    );
  }

  if (query.isPending) {
    return <p className="text-sm text-neutral-500">Loading task-agent registry…</p>;
  }
  if (query.isError) {
    return <p className="text-sm text-danger">{query.error.message}</p>;
  }

  const agents = query.data?.agents ?? [];

  return (
    <div className="space-y-4">
      <StubBadge tone="info">{agents.length} registered agents</StubBadge>

      <div className="divide-y divide-border rounded-lg border border-border bg-surface">
        {agents.map((agent) => (
          <article key={agent.id} className="flex flex-col gap-3 px-4 py-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm text-foreground">{agent.title}</p>
                  <StubBadge tone="neutral">{agent.trigger}</StubBadge>
                  {agent.guardrails.invokesLLM ? (
                    <StubBadge tone="info">LLM</StubBadge>
                  ) : null}
                </div>
                <p className="mt-0.5 font-mono text-xs text-neutral-500">{agent.id}</p>
                <p className="mt-1 text-xs text-neutral-400">{agent.description}</p>
                <p className="mt-1 text-xs text-neutral-500">
                  guardrail: {agent.guardrails.autonomyDomain} · {agent.guardrails.autonomyAction}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-end gap-3">
              <label className="block flex-1 min-w-[16rem]">
                <span className="mb-1 block text-xs uppercase tracking-wider text-neutral-500">
                  Payload (JSON object, optional)
                </span>
                <input
                  type="text"
                  value={payloadById[agent.id] ?? ''}
                  onChange={(e) =>
                    setPayloadById((prev) => ({ ...prev, [agent.id]: e.target.value }))
                  }
                  placeholder='{ "key": "value" }'
                  className="w-full rounded-md border border-border bg-surface-sunken px-3 py-1.5 font-mono text-xs text-foreground placeholder:text-neutral-600 focus:border-signal-500 focus:outline-none"
                />
              </label>
              <button
                type="button"
                disabled={run.isPending}
                onClick={() => onRun(agent)}
                className="rounded-md border border-border px-3 py-1.5 text-xs text-signal-500 hover:bg-surface-sunken disabled:opacity-40"
              >
                Run
              </button>
            </div>
          </article>
        ))}
      </div>

      <Toast message={toast} tone={tone} onDismiss={() => setToast(null)} />
    </div>
  );
}
