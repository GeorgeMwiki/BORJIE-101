'use client';

import { useState } from 'react';
import { StubBadge } from '../StubBadge';
import { Toast } from '../Toast';
import {
  usePersonas,
  useRefreshPersonas,
  useDeletePersona,
} from '@/lib/internal/wave9/queries';
import type { Persona } from '@/lib/internal/wave9/api';

/**
 * Persona registry (I-W-25, SUPER_ADMIN / ADMIN).
 *
 * Lists every brain persona (platform + tenant) and lets an operator
 * refresh from the DB or remove a persona. The gateway gates every route on
 * SUPER_ADMIN / ADMIN and fans hot-swaps out across the cross-portal bus.
 */
export function PersonaRegistry(): JSX.Element {
  const query = usePersonas();
  const refresh = useRefreshPersonas();
  const remove = useDeletePersona();
  const [toast, setToast] = useState<string | null>(null);
  const [tone, setTone] = useState<'success' | 'danger'>('success');
  const [confirmId, setConfirmId] = useState<string | null>(null);

  function announce(message: string, nextTone: 'success' | 'danger') {
    setTone(nextTone);
    setToast(message);
  }

  function onRefresh() {
    refresh.mutate(undefined, {
      onSuccess: () => announce('Persona registry refreshed from DB.', 'success'),
      onError: (err) => announce(`Refresh failed: ${err.message}`, 'danger'),
    });
  }

  function onDelete(p: Persona) {
    if (confirmId !== p.id) {
      setConfirmId(p.id);
      return;
    }
    remove.mutate(p.id, {
      onSuccess: () => {
        announce(`Persona '${p.id}' removed.`, 'success');
        setConfirmId(null);
      },
      onError: (err) => announce(`Delete failed: ${err.message}`, 'danger'),
    });
  }

  if (query.isPending) {
    return <p className="text-sm text-neutral-500">Loading persona registry…</p>;
  }
  if (query.isError) {
    return <p className="text-sm text-danger">{query.error.message}</p>;
  }

  const personas = query.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <StubBadge tone="danger">SUPER_ADMIN · cross-portal hot-swap</StubBadge>
        <button
          type="button"
          disabled={refresh.isPending}
          onClick={onRefresh}
          className="rounded-md border border-border px-3 py-1.5 text-xs text-neutral-300 hover:bg-surface disabled:opacity-40"
        >
          Refresh from DB
        </button>
      </div>

      {personas.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface px-4 py-8 text-center">
          <p className="text-sm text-neutral-400">No personas registered.</p>
        </div>
      ) : (
        <div className="divide-y divide-border rounded-lg border border-border bg-surface">
          {personas.map((p) => (
            <article key={p.id} className="flex flex-col gap-2 px-4 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm text-foreground">{p.displayName}</p>
                    <span className="font-mono text-xs text-neutral-500">{p.id}</span>
                    <StubBadge tone="neutral">{p.firstPersonNoun}</StubBadge>
                  </div>
                  <p className="mt-1 text-xs italic text-neutral-400">
                    “{p.openingStatement}”
                  </p>
                  <p className="mt-1 text-xs text-neutral-500">{p.toneGuidance}</p>
                  {p.taboos.length > 0 ? (
                    <p className="mt-1 text-xs text-neutral-500">
                      taboos: {p.taboos.join(', ')}
                    </p>
                  ) : null}
                </div>
                <button
                  type="button"
                  disabled={remove.isPending}
                  onClick={() => onDelete(p)}
                  className="shrink-0 rounded-md border border-border px-3 py-1.5 text-xs text-danger hover:bg-surface-sunken disabled:opacity-40"
                >
                  {confirmId === p.id ? 'Confirm delete' : 'Delete'}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      <Toast message={toast} tone={tone} onDismiss={() => setToast(null)} />
    </div>
  );
}
