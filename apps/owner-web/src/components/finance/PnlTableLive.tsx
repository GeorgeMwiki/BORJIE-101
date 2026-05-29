'use client';

/**
 * R-FUTURE-3 PnlTable consumer.
 *
 * Wraps the presentational `<PnlTable />` with the react-query binding
 * to `/api/v1/owner/finance/pnl`. Renders three UX states:
 *   1. loading skeleton — four pulsing rows.
 *   2. error envelope — sw/en string + retry button.
 *   3. data envelope — the live `<PnlTable />`.
 *
 * The empty-tenant case (no sales / no costs) is the SAME as the
 * data envelope with `rows: []` — `<PnlTable />` already renders the
 * four group headers cleanly when the array is empty.
 */

import { useState } from 'react';
import { PnlTable } from './PnlTable';
import { usePnl, currentMonthYYYYMM } from '@/lib/queries/pnl';

interface PnlTableLiveProps {
  readonly locale: 'sw' | 'en';
  readonly initialMonth?: string;
}

export function PnlTableLive({ locale, initialMonth }: PnlTableLiveProps) {
  const [month, setMonth] = useState<string>(
    initialMonth ?? currentMonthYYYYMM(),
  );
  const { data, isLoading, isError, refetch } = usePnl(month);

  return (
    <article className="rounded-md border border-border bg-surface px-4 py-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">
          {locale === 'sw' ? 'P&L ya mwezi' : 'Monthly P&L'}
        </h3>
        <input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="rounded border border-border bg-background px-2 py-1 text-xs text-foreground"
          aria-label={locale === 'sw' ? 'Chagua mwezi' : 'Select month'}
        />
      </div>
      {isLoading && (
        <div className="space-y-2" data-testid="pnl-loading">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="h-6 animate-pulse rounded bg-surface-raised"
            />
          ))}
        </div>
      )}
      {isError && (
        <div
          className="rounded border border-destructive/60 bg-destructive/10 p-3 text-xs text-destructive"
          data-testid="pnl-error"
        >
          {locale === 'sw'
            ? 'Imeshindwa kuchukua P&L. Jaribu tena.'
            : 'Failed to load P&L. Try again.'}
          <button
            type="button"
            onClick={() => refetch()}
            className="ml-2 underline"
          >
            {locale === 'sw' ? 'Jaribu tena' : 'Retry'}
          </button>
        </div>
      )}
      {data && !isLoading && !isError && (
        <PnlTable rows={data.rows} />
      )}
    </article>
  );
}
