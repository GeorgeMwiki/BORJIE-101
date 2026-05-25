'use client';

import { useState } from 'react';
import { StubBadge } from '../StubBadge';
import { DataSourceBadge } from '../DataSourceBadge';
import { Toast } from '../Toast';
import { TwoOperatorConfirm } from './TwoOperatorConfirm';
import { useKillswitchQuery, useSetKillswitch } from '@/lib/internal/queries/killswitch';
import type { SwitchState } from '@/lib/mocks/types';

const STATES: ReadonlyArray<SwitchState> = ['OK', 'DEGRADED', 'HALT'];

function tone(state: SwitchState): 'success' | 'warn' | 'danger' {
  if (state === 'OK') return 'success';
  if (state === 'DEGRADED') return 'warn';
  return 'danger';
}

/**
 * The current operator's identity normally comes from the SSO claim
 * read by middleware.ts; the killswitch UI only needs an ID it can
 * compare against the second-operator entry. Until that wiring lands
 * we stub it as `op_self` — the two-operator-confirm flow still
 * exercises the same code path.
 */
const CURRENT_OPERATOR = 'op_self';

interface Pending {
  readonly juniorId: string;
  readonly junior: string;
  readonly target: SwitchState;
}

export function KillswitchControls(): JSX.Element {
  const query = useKillswitchQuery();
  const mutate = useSetKillswitch();
  const [pending, setPending] = useState<Pending | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  if (query.isPending) return <p className="text-sm text-neutral-500">Loading killswitch…</p>;
  if (query.isError) return <p className="text-sm text-danger">{query.error.message}</p>;

  const rows = query.data?.rows ?? [];

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-danger/40 bg-danger/5 p-6">
        <h3 className="text-sm font-medium text-foreground mb-2">Global platform state</h3>
        <p className="text-xs text-neutral-400 mb-4">
          Hits every junior on every tenant. Use only in true emergencies; two-operator confirm required.
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setPending({ juniorId: 'global', junior: 'Global', target: 'DEGRADED' })}
            className="rounded-md bg-warning/20 px-3 py-1.5 text-xs font-medium text-warning hover:bg-warning/30"
          >
            Set DEGRADED
          </button>
          <button
            type="button"
            onClick={() => setPending({ juniorId: 'global', junior: 'Global', target: 'HALT' })}
            className="rounded-md bg-danger/20 px-3 py-1.5 text-xs font-medium text-danger hover:bg-danger/30"
          >
            Set HALT
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
                      disabled={row.state === s}
                      onClick={() => setPending({ juniorId: row.juniorId, junior: row.junior, target: s })}
                      className={`rounded-md border px-2 py-1 text-xs ${
                        row.state === s
                          ? 'border-signal-500 bg-signal-500/10 text-signal-500 cursor-default'
                          : 'border-border text-neutral-300 hover:bg-surface'
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

      <DataSourceBadge source={query.data?.source ?? 'mock'} />

      <TwoOperatorConfirm
        open={Boolean(pending)}
        junior={pending?.junior ?? ''}
        currentOperatorId={CURRENT_OPERATOR}
        target={pending?.target ?? 'OK'}
        busy={mutate.isPending}
        onCancel={() => setPending(null)}
        onConfirm={(secondOperatorId) => {
          if (!pending) return;
          mutate.mutate(
            {
              juniorId: pending.juniorId,
              state: pending.target,
              firstOperatorId: CURRENT_OPERATOR,
              secondOperatorId,
            },
            {
              onSuccess: () => {
                setToast(`${pending.junior} → ${pending.target}`);
                setPending(null);
              },
              onError: (err) => setToast(`Failed: ${err instanceof Error ? err.message : 'unknown'}`),
            }
          );
        }}
      />
      <Toast message={toast} tone={mutate.isError ? 'danger' : 'success'} onDismiss={() => setToast(null)} />
    </div>
  );
}
