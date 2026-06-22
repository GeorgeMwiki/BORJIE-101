'use client';

import { useEffect, useState } from 'react';
import { Button } from '@borjie/design-system';
import { StubBadge } from '../StubBadge';
import { useLocale, pickByLocale, type Locale } from '@/lib/locale';
import {
  useConfirmKillswitch,
  usePendingConfirmations,
  type PendingConfirmation,
} from '@/lib/internal/queries/killswitch';

interface PendingConfirmationsQueueProps {
  readonly onResult: (msg: string) => void;
  readonly initialLocale?: Locale;
}

const S = {
  title: {
    en: 'Pending two-operator confirmations',
    sw: 'Uthibitisho wa waendeshaji wawili unaosubiri',
  },
  waiting: { en: 'waiting', sw: 'wanaosubiri' },
  body: {
    en: 'Each entry was initiated by another operator. You must hold a matching killswitch authority AND confirm before the 30s window closes.',
    sw: 'Kila kipengele kilianzishwa na opereta mwingine. Lazima uwe na mamlaka linganifu ya kizima-dharura NA uthibitishe kabla ya dirisha la sekunde 30 kufungwa.',
  },
  reason: { en: 'reason', sw: 'sababu' },
  initiator: { en: 'initiator', sw: 'mwanzilishi' },
  expired: { en: 'expired', sw: 'imekwisha muda' },
  left: { en: 'left', sw: 'zimebaki' },
  confirm: { en: 'Confirm', sw: 'Thibitisha' },
} as const;

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
  initialLocale,
}: PendingConfirmationsQueueProps): JSX.Element | null {
  const locale = useLocale(initialLocale);
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
    <section className="rounded-lg border border-warning/40 bg-warning-subtle p-6">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-foreground">
          {pickByLocale(locale, S.title)}
        </h3>
        <StubBadge tone="warn">
          {rows.length} {pickByLocale(locale, S.waiting)}
        </StubBadge>
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        {pickByLocale(locale, S.body)}
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
                  <code className="text-xs text-muted-foreground">{row.killswitchTarget.scope}</code>
                  <StubBadge tone={targetLevelTone(row.killswitchTarget.level)}>
                    {row.killswitchTarget.level}
                  </StubBadge>
                </div>
                <p className="text-xs text-muted-foreground">
                  {pickByLocale(locale, S.reason)}: {row.killswitchTarget.reasonCode}
                  {row.killswitchTarget.note ? ` — ${row.killswitchTarget.note}` : ''}
                </p>
                <p className="text-xs text-muted-foreground">
                  {pickByLocale(locale, S.initiator)}:{' '}
                  <code>{row.initiatorUserId.slice(0, 8)}…</code>
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span
                  className={`text-xs tabular-nums ${stale ? 'text-danger' : 'text-warning'}`}
                >
                  {stale
                    ? pickByLocale(locale, S.expired)
                    : `${remaining}s ${pickByLocale(locale, S.left)}`}
                </span>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  disabled={stale || confirm.isPending}
                  loading={confirm.isPending}
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
                >
                  {pickByLocale(locale, S.confirm)}
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
