'use client';

import { useState } from 'react';
import { Button } from '@borjie/design-system';
import { StubBadge } from '../StubBadge';
import { Toast } from '../Toast';
import {
  useJuniorAis,
  useSuspendJunior,
  useRevokeJunior,
} from '@/lib/internal/wave9/queries';
import type { JuniorAi } from '@/lib/internal/wave9/api';

function statusTone(status: string): 'success' | 'warn' | 'danger' | 'neutral' {
  if (status === 'active') return 'success';
  if (status === 'suspended') return 'warn';
  if (status === 'revoked') return 'danger';
  return 'neutral';
}

/**
 * Junior-AI Factory (I-W-23).
 *
 * Lists the juniors provisioned for the caller (GET /junior-ai/mine) and
 * lets an operator suspend (reversible, with reason) or revoke (terminal)
 * each one. The gateway enforces the team-lead role gate + lifecycle rules.
 */
export function JuniorAiFactory(): JSX.Element {
  const query = useJuniorAis();
  const suspend = useSuspendJunior();
  const revoke = useRevokeJunior();
  const [toast, setToast] = useState<string | null>(null);
  const [tone, setTone] = useState<'success' | 'danger'>('success');
  const [reasonById, setReasonById] = useState<Record<string, string>>({});

  function announce(message: string, nextTone: 'success' | 'danger') {
    setTone(nextTone);
    setToast(message);
  }

  function onSuspend(j: JuniorAi) {
    const reason = (reasonById[j.id] ?? '').trim();
    if (reason.length < 1) {
      announce('Enter a suspend reason first.', 'danger');
      return;
    }
    suspend.mutate(
      { id: j.id, reason },
      {
        onSuccess: () => announce(`${j.id.slice(0, 8)}… suspended`, 'success'),
        onError: (err) => announce(`Suspend failed: ${err.message}`, 'danger'),
      },
    );
  }

  function onRevoke(j: JuniorAi) {
    revoke.mutate(j.id, {
      onSuccess: () => announce(`${j.id.slice(0, 8)}… revoked`, 'success'),
      onError: (err) => announce(`Revoke failed: ${err.message}`, 'danger'),
    });
  }

  if (query.isPending) {
    return <p className="text-sm text-neutral-500">Loading provisioned juniors…</p>;
  }
  if (query.isError) {
    return <p className="text-sm text-danger">{query.error.message}</p>;
  }

  const items = query.data ?? [];
  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-surface px-4 py-8 text-center">
        <p className="text-sm text-neutral-400">No juniors provisioned for this account.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <StubBadge tone="info">{items.length} provisioned · team-lead gate upstream</StubBadge>

      <div className="divide-y divide-border rounded-lg border border-border bg-surface">
        {items.map((j) => {
          const busy = suspend.isPending || revoke.isPending;
          const terminal = j.status === 'revoked';
          return (
            <article key={j.id} className="flex flex-col gap-3 px-4 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm text-foreground">{j.domain}</p>
                    <StubBadge tone={statusTone(j.status)}>{j.status}</StubBadge>
                    {j.certificationRequired ? (
                      <StubBadge tone="neutral">cert required</StubBadge>
                    ) : null}
                  </div>
                  <p className="mt-0.5 font-mono text-xs text-neutral-500">{j.id}</p>
                  <p className="mt-1 text-xs text-neutral-400">{j.mandate}</p>
                </div>
                {j.memoryScope ? (
                  <StubBadge tone="neutral">{j.memoryScope} memory</StubBadge>
                ) : null}
              </div>

              {!terminal ? (
                <div className="flex flex-wrap items-end gap-3">
                  <label className="block flex-1 min-w-[12rem]">
                    <span className="mb-1 block text-xs uppercase tracking-wider text-neutral-500">
                      Suspend reason
                    </span>
                    <input
                      type="text"
                      value={reasonById[j.id] ?? ''}
                      onChange={(e) =>
                        setReasonById((prev) => ({ ...prev, [j.id]: e.target.value }))
                      }
                      placeholder="Why pause this junior?"
                      className="w-full rounded-md border border-border bg-surface-sunken px-3 py-1.5 text-sm text-foreground placeholder:text-neutral-600 focus:border-signal-500 focus:outline-none"
                    />
                  </label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy || j.status === 'suspended'}
                    onClick={() => onSuspend(j)}
                    className="text-warning"
                  >
                    Suspend
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    disabled={busy}
                    onClick={() => onRevoke(j)}
                  >
                    Revoke
                  </Button>
                </div>
              ) : null}
            </article>
          );
        })}
      </div>

      <Toast message={toast} tone={tone} onDismiss={() => setToast(null)} />
    </div>
  );
}
