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
import { Button, Skeleton, Alert, Input } from '@borjie/design-system';
import { PnlTable } from './PnlTable';
import { usePnl, currentMonthYYYYMM } from '@/lib/queries/pnl';
import { pickByLocale } from '@/lib/locale-shared';
import { dataAStrings as S } from '@/i18n/strings/data-a';

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
          {locale === 'sw' ? S.pnl.monthlyTitle.sw : S.pnl.monthlyTitle.en}
        </h3>
        <Input
          type="month"
          inputSize="sm"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="w-auto"
          aria-label={pickByLocale(locale, S.pnl.selectMonth)}
        />
      </div>
      {isLoading && (
        <div className="space-y-2" data-testid="pnl-loading">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-6 rounded" />
          ))}
        </div>
      )}
      {isError && (
        <Alert variant="error" data-testid="pnl-error">
          {pickByLocale(locale, S.pnl.loadError)}
          <Button
            type="button"
            variant="link"
            size="sm"
            onClick={() => refetch()}
            className="ml-2"
          >
            {pickByLocale(locale, S.pnl.retry)}
          </Button>
        </Alert>
      )}
      {data && !isLoading && !isError && (
        <PnlTable rows={data.rows} />
      )}
    </article>
  );
}
