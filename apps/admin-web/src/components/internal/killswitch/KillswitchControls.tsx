'use client';

import { useState } from 'react';
import { Button, Skeleton, Alert } from '@borjie/design-system';
import { StubBadge } from '../StubBadge';
import { DataSourceBadge } from '../DataSourceBadge';
import { Toast } from '../Toast';
import { PendingConfirmationsQueue } from './PendingConfirmationsQueue';
import {
  useInitiateKillswitch,
  useKillswitchQuery,
} from '@/lib/internal/queries/killswitch';
import { useLocale, pickByLocale, type Locale } from '@/lib/locale';
import type { SwitchState } from '@/lib/internal/types';

const STATES: ReadonlyArray<SwitchState> = ['OK', 'DEGRADED', 'HALT'];

const S = {
  loading: { en: 'Loading killswitch…', sw: 'Inapakia kizima-dharura…' },
  globalTitle: { en: 'Global platform state', sw: 'Hali ya jukwaa lote' },
  globalBody: {
    en: 'Hits every junior on every tenant. Use only in true emergencies; a second operator must confirm within 30s.',
    sw: 'Inagusa kila msaidizi kwa kila mteja. Tumia tu katika dharura halisi; opereta wa pili lazima athibitishe ndani ya sekunde 30.',
  },
  initiateDegraded: { en: 'Initiate DEGRADED', sw: 'Anzisha DEGRADED' },
  initiateHalt: { en: 'Initiate HALT', sw: 'Anzisha HALT' },
  perJuniorTitle: { en: 'Per-junior state', sw: 'Hali ya kila msaidizi' },
  updatedBy: { en: 'Updated', sw: 'Imesasishwa' },
  by: { en: 'by', sw: 'na' },
} as const;

function tone(state: SwitchState): 'success' | 'warn' | 'danger' {
  if (state === 'OK') return 'success';
  if (state === 'DEGRADED') return 'warn';
  return 'danger';
}

export function KillswitchControls({
  initialLocale,
}: {
  readonly initialLocale?: Locale;
} = {}): JSX.Element {
  const locale = useLocale(initialLocale);
  const query = useKillswitchQuery();
  const initiate = useInitiateKillswitch();
  const [toast, setToast] = useState<string | null>(null);

  if (query.isPending) {
    return (
      <div className="space-y-4" aria-label={pickByLocale(locale, S.loading)}>
        <Skeleton className="h-32 w-full rounded-lg" />
        <Skeleton className="h-44 w-full rounded-lg" />
      </div>
    );
  }
  if (query.isError) {
    return <Alert variant="error">{query.error.message}</Alert>;
  }

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
      <PendingConfirmationsQueue onResult={setToast} initialLocale={locale} />

      <section className="rounded-lg border border-danger/40 bg-danger-subtle p-6">
        <h3 className="text-sm font-medium text-foreground mb-2">
          {pickByLocale(locale, S.globalTitle)}
        </h3>
        <p className="text-xs text-muted-foreground mb-4">
          {pickByLocale(locale, S.globalBody)}
        </p>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="warning"
            size="sm"
            disabled={initiate.isPending}
            onClick={() => onInitiate('global', 'Global', 'DEGRADED')}
          >
            {pickByLocale(locale, S.initiateDegraded)}
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={initiate.isPending}
            onClick={() => onInitiate('global', 'Global', 'HALT')}
          >
            {pickByLocale(locale, S.initiateHalt)}
          </Button>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-surface p-6">
        <h3 className="text-sm font-medium text-foreground mb-4">
          {pickByLocale(locale, S.perJuniorTitle)}
        </h3>
        <ul className="space-y-2">
          {rows.map((row) => (
            <li
              key={row.juniorId}
              className="flex items-center justify-between rounded-md border border-border bg-surface-sunken px-4 py-3"
            >
              <div>
                <p className="text-sm text-foreground">{row.junior}</p>
                <p className="text-xs text-muted-foreground">
                  {pickByLocale(locale, S.updatedBy)}{' '}
                  {row.updatedAt.replace('T', ' ').slice(0, 16)}{' '}
                  {pickByLocale(locale, S.by)} {row.updatedBy}
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
                      className={`rounded-md border px-2 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/40 ${
                        row.state === s
                          ? 'border-signal-500 bg-signal-500/10 text-signal-500 cursor-default'
                          : 'border-border text-muted-foreground hover:bg-surface disabled:opacity-50'
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
