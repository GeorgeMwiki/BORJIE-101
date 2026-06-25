'use client';

import { useState } from 'react';
import { Bot } from 'lucide-react';
import { Button, Skeleton, Alert, Empty, FormField, Input } from '@borjie/design-system';
import { StubBadge } from '../StubBadge';
import { Toast } from '../Toast';
import { useLocale, pickByLocale, type Locale } from '@/lib/locale';
import { useTaskAgents, useRunTaskAgent } from '@/lib/internal/wave9/queries';
import type { TaskAgent } from '@/lib/internal/wave9/api';
import { localizeApiError } from '@borjie/error-catalog';

/**
 * Task-Agents registry (I-W-24).
 *
 * Lists the uniform registry of narrow-scope task agents (id, trigger,
 * guardrails) and lets an operator manually trigger one. The payload is a
 * free-form JSON object; the gateway validates it against the agent's own
 * zod schema and runs the executor (503 when the executor isn't wired).
 */
const S = {
  loading: { en: 'Loading task-agent registry…', sw: 'Inapakia rejista ya wakala-kazi…' },
  emptyTitle: { en: 'No task agents registered', sw: 'Hakuna wakala-kazi waliosajiliwa' },
  emptyBody: {
    en: 'Narrow-scope task agents appear here once they are registered.',
    sw: 'Wakala-kazi wenye wigo finyu huonekana hapa mara wanaposajiliwa.',
  },
  registered: { en: 'registered agents', sw: 'wakala waliosajiliwa' },
  guardrail: { en: 'guardrail', sw: 'kizuizi' },
  payloadLabel: { en: 'Payload (JSON object, optional)', sw: 'Mzigo (kitu cha JSON, hiari)' },
  run: { en: 'Run', sw: 'Endesha' },
  payloadObject: { en: 'Payload must be a JSON object.', sw: 'Mzigo lazima uwe kitu cha JSON.' },
  payloadInvalid: { en: 'Payload is not valid JSON.', sw: 'Mzigo si JSON halali.' },
  triggered: { en: 'triggered', sw: 'imeanzishwa' },
  runFailed: { en: 'Run failed', sw: 'Kuendesha kumeshindwa' },
} as const;

export function TaskAgentsRegistry({
  initialLocale,
}: {
  readonly initialLocale?: Locale;
} = {}): JSX.Element {
  const locale = useLocale(initialLocale);
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
          announce(pickByLocale(locale, S.payloadObject), 'danger');
          return;
        }
      } catch {
        announce(pickByLocale(locale, S.payloadInvalid), 'danger');
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
    return (
      <Skeleton
        className="h-48 w-full rounded-lg"
        aria-label={pickByLocale(locale, S.loading)}
      />
    );
  }
  if (query.isError) {
    return <Alert variant="error">{localizeApiError(query.error, locale)}</Alert>;
  }

  const agents = query.data?.agents ?? [];

  if (agents.length === 0) {
    return (
      <Empty
        icon={<Bot className="h-8 w-8" />}
        title={pickByLocale(locale, S.emptyTitle)}
        description={pickByLocale(locale, S.emptyBody)}
      />
    );
  }

  return (
    <div className="space-y-4">
      <StubBadge tone="info">
        {agents.length} {pickByLocale(locale, S.registered)}
      </StubBadge>

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
                <p className="mt-0.5 font-mono text-xs text-muted-foreground">{agent.id}</p>
                <p className="mt-1 text-xs text-muted-foreground">{agent.description}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {pickByLocale(locale, S.guardrail)}: {agent.guardrails.autonomyDomain} ·{' '}
                  {agent.guardrails.autonomyAction}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-end gap-3">
              <FormField
                label={pickByLocale(locale, S.payloadLabel)}
                htmlFor={`payload-${agent.id}`}
                className="flex-1 min-w-[16rem] space-y-1"
              >
                <Input
                  id={`payload-${agent.id}`}
                  type="text"
                  inputSize="sm"
                  className="font-mono"
                  value={payloadById[agent.id] ?? ''}
                  onChange={(e) =>
                    setPayloadById((prev) => ({ ...prev, [agent.id]: e.target.value }))
                  }
                  placeholder='{ "key": "value" }'
                />
              </FormField>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={run.isPending}
                loading={run.isPending}
                onClick={() => onRun(agent)}
              >
                {pickByLocale(locale, S.run)}
              </Button>
            </div>
          </article>
        ))}
      </div>

      <Toast message={toast} tone={tone} onDismiss={() => setToast(null)} />
    </div>
  );
}
