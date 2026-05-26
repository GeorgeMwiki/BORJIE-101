'use client';

import { useState } from 'react';
import { StubBadge } from '../StubBadge';
import { DataSourceBadge } from '../DataSourceBadge';
import { Toast } from '../Toast';
import { PendingConfirmationsQueue } from './PendingConfirmationsQueue';
import {
  useInitiateKillswitch,
  useKillswitchQuery,
} from '@/lib/internal/queries/killswitch';
import type { SwitchState } from '@/lib/internal/types';

const STATES: ReadonlyArray<SwitchState> = ['OK', 'DEGRADED', 'HALT'];

function tone(state: SwitchState): 'success' | 'warn' | 'danger' {
  if (state === 'OK') return 'success';
  if (state === 'DEGRADED') return 'warn';
  return 'danger';
}

export function KillswitchControls(): JSX.Element {
  const query = useKillswitchQuery();
  const initiate = useInitiateKillswitch();
  const [toast, setToast] = useState<string | null>(null);

  if (query.isPending) return <p className="text-sm text-neutral-500">Loading killswitch…</p>;
  if (query.isError) return <p className="text-sm text-danger">{query.error.message}</p>;

  const rows = query.data?.rows ?? [];

  function onInitiate(juniorId: string, junior: string, target: SwitchState) {
    initiate.mutate(
      { juniorId, state: target },
      {
        onSuccess: (res) => {
          setToast(
            `${junior} → ${target} initiated (id ${res.pendingConfirmationId.slice(0, 8)}…) — second operator must confirm within 30s.`,
          );
        },
        onError: (err) => {
          setToast(`Failed: ${err instanceof Error ? err.message : 'unknown'}`);
        },
      },
    );
  }

  return (
    <div className="space-y-6">
      <PendingConfirmationsQueue onResult={setToast} />

      <section className="rounded-lg border border-danger/40 bg-danger/5 p-6">
        <h3 className="text-sm font-medium text-foreground mb-2">Global platform state</h3>
        <p className="text-xs text-neutral-400 mb-4">
          Hits every junior on every tenant. Use only in true emergencies; a second operator must
          confirm within 30s.
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={initiate.isPending}
            onClick={() => onInitiate('global', 'Global', 'DEGRADED')}
            className="rounded-md bg-warning/20 px-3 py-1.5 text-xs font-medium text-warning hover:bg-warning/30 disabled:opacity-50"
          >
            Initiate DEGRADED
          </button>
          <button
            type="button"
            disabled={initiate.isPending}
            onClick={() => onInitiate('global', 'Global', 'HALT')}
            className="rounded-md bg-danger/20 px-3 py-1.5 text-xs font-medium text-danger hover:bg-danger/30 disabled:opacity-50"
          >
            Initiate HALT
          </button>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-surface p-6">
        <h3 className="text-sm font-medium text-foreground mb-4">Per-junior state</h3>
        <ul className="space-y-2">
          {rows.map((row) => (
            <li
              key={row.juniorId}
              className="flex items-center justify-between rounded-md border border-border bg-surface-sunken px-4 py-3"
            >
              <div>
                <p className="text-sm text-foreground">{row.junior}</p>
                <p className="text-xs text-neutral-500">
                  Updated {row.updatedAt.replace('T', ' ').slice(0, 16)} by {row.updatedBy}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <StubBadge tone={tone(row.state)}>{row.state}</StubBadge>
                <div className="flex gap-1">
                  {STATES.map((s) => (
                    <button
                      key={s}
                      type="button"
                      disabled={row.state === s || initiate.isPending}
                      onClick={() => onInitiate(row.juniorId, row.junior, s)}
                      className={`rounded-md border px-2 py-1 text-xs ${
                        row.state === s
                          ? 'border-signal-500 bg-signal-500/10 text-signal-500 cursor-default'
                          : 'border-border text-neutral-300 hover:bg-surface disabled:opacity-50'
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <DataSourceBadge source={query.data?.source ?? 'live'} />

      <Toast
        message={toast}
        tone={initiate.isError ? 'danger' : 'success'}
        onDismiss={() => setToast(null)}
      />
    </div>
  );
}
