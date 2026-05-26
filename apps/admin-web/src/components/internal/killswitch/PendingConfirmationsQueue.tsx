'use client';

import { useEffect, useState } from 'react';
import { StubBadge } from '../StubBadge';
import {
  useConfirmKillswitch,
  usePendingConfirmations,
  type PendingConfirmation,
} from '@/lib/internal/queries/killswitch';

interface PendingConfirmationsQueueProps {
  readonly onResult: (msg: string) => void;
}

function secondsRemaining(expiresAt: string, nowMs: number): number {
  const remaining = Math.max(0, Date.parse(expiresAt) - nowMs);
  return Math.ceil(remaining / 1000);
}

function targetLevelTone(level: PendingConfirmation['killswitchTarget']['level']) {
  if (level === 'live') return 'success' as const;
  if (level === 'degraded') return 'warn' as const;
  return 'danger' as const;
}

/**
 * Live queue of pending kill-switch confirmations. The gateway already
 * filters out rows the caller initiated, so every row here is
 * actionable. Polls every 3s; each row counts down to expiry.
 */
export function PendingConfirmationsQueue({
  onResult,
}: PendingConfirmationsQueueProps): JSX.Element | null {
  const query = usePendingConfirmations(3_000);
  const confirm = useConfirmKillswitch();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(id);
  }, []);

  const rows = query.data ?? [];
  if (rows.length === 0) return null;

  return (
    <section className="rounded-lg border border-warning/40 bg-warning/5 p-6">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-foreground">
          Pending two-operator confirmations
        </h3>
        <StubBadge tone="warn">{rows.length} waiting</StubBadge>
      </div>
      <p className="text-xs text-neutral-400 mb-4">
        Each entry was initiated by another operator. You must hold a matching killswitch authority
        AND confirm before the 30s window closes.
      </p>
      <ul className="space-y-2">
        {rows.map((row) => {
          const remaining = secondsRemaining(row.expiresAt, now);
          const stale = remaining <= 0;
          return (
            <li
              key={row.id}
              className="flex items-center justify-between rounded-md border border-border bg-surface-sunken px-4 py-3"
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <code className="text-xs text-neutral-400">{row.killswitchTarget.scope}</code>
                  <StubBadge tone={targetLevelTone(row.killswitchTarget.level)}>
                    {row.killswitchTarget.level}
                  </StubBadge>
                </div>
                <p className="text-xs text-neutral-500">
                  reason: {row.killswitchTarget.reasonCode}
                  {row.killswitchTarget.note ? ` — ${row.killswitchTarget.note}` : ''}
                </p>
                <p className="text-xs text-neutral-500">
                  initiator: <code>{row.initiatorUserId.slice(0, 8)}…</code>
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span
                  className={`text-xs tabular-nums ${stale ? 'text-danger' : 'text-warning'}`}
                >
                  {stale ? 'expired' : `${remaining}s left`}
                </span>
                <button
                  type="button"
                  disabled={stale || confirm.isPending}
                  onClick={() =>
                    confirm.mutate(row.id, {
                      onSuccess: () =>
                        onResult(
                          `Confirmed ${row.killswitchTarget.scope} → ${row.killswitchTarget.level}`,
                        ),
                      onError: (err) =>
                        onResult(
                          `Confirm failed: ${err instanceof Error ? err.message : 'unknown'}`,
                        ),
                    })
                  }
                  className="rounded-md bg-danger/20 px-3 py-1.5 text-xs font-medium text-danger hover:bg-danger/30 disabled:opacity-50"
                >
                  Confirm
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
