'use client';

import { Card } from '@borjie/design-system';
import { formatMoney, LAUNCH_CURRENCY } from '@/lib/format';
import { useLocale } from '@/lib/locale';
import type { Locale } from '@/lib/locale';
import { financeTablesStrings as S } from '@/i18n/strings/finance-tables';
import type {
  CashRunwaySlot,
  CliffStatusSlot,
} from '@/lib/queries/owner-brief';

interface CashRunwayCardProps {
  readonly cashRunway: CashRunwaySlot;
  readonly cliffStatus: CliffStatusSlot;
  /**
   * Server-resolved locale, threaded from the dashboard surface so this
   * island SEEDS its first client render to the SAME language as the SSR
   * chrome — without it `useLocale` defaults to `en` and flashes a
   * one-frame EN-under-SW split-brain (the zero-mix canon violation that
   * the sibling cards already avoid).
   */
  readonly initialLocale?: Locale | undefined;
}

/**
 * Cash & USD-cliff card — sits beside the production table.
 *
 * Combines the 90-day net inflow (used as a runway proxy) with the
 * post-27-Mar USD cliff tracker so the owner sees both numbers
 * together. Every string renders in the ACTIVE locale (no EN/SW mixing);
 * money flows through `formatMoney` with the launch currency as data.
 */
export function CashRunwayCard({
  cashRunway,
  cliffStatus,
  initialLocale,
}: CashRunwayCardProps): JSX.Element {
  const locale = useLocale(initialLocale);
  const dailyAvg = cashRunway.dailyAvgTzs;
  const projectedDays =
    dailyAvg > 0
      ? Math.round(Math.max(cashRunway.ninetyDayNetTzs, 0) / dailyAvg)
      : null;
  const cliff = new Date(cliffStatus.cliffDateIso);
  const cliffDays = Number.isNaN(cliff.getTime())
    ? null
    : Math.round((cliff.getTime() - Date.now()) / (24 * 60 * 60 * 1000));

  const runwayPill =
    projectedDays === null
      ? 'pill-amber'
      : projectedDays >= 90
        ? 'pill-green'
        : projectedDays >= 45
          ? 'pill-amber'
          : 'pill-red';
  const cliffPill = cliffStatus.remediationComplete
    ? 'pill-green'
    : cliffDays !== null && cliffDays < 30
      ? 'pill-red'
      : 'pill-amber';

  return (
    <Card
      hoverable
      className="flex h-full flex-col gap-3 p-5"
      data-testid="dashboard-cash-runway"
    >
      <header>
        <h2 className="cockpit-card-title">{S.cashRunway.title[locale]}</h2>
      </header>

      <div>
        <div className="font-display text-2xl text-foreground">
          {formatMoney(
            Math.max(cashRunway.ninetyDayNetTzs, 0),
            LAUNCH_CURRENCY,
            locale,
          )}
        </div>
        <p className="cockpit-card-meta">
          {S.cashRunway.netDays(cashRunway.sampleCount)[locale]}
        </p>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <span className={`pill ${runwayPill}`}>
          {projectedDays === null
            ? S.cashRunway.runwayUnknown[locale]
            : S.cashRunway.daysRunway(projectedDays)[locale]}
        </span>
      </div>

      <hr className="border-border/40" />

      <div>
        <div className="text-xs text-neutral-500">
          {S.cashRunway.postureLabel[locale]}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <span className={`pill ${cliffPill}`}>
            {cliffStatus.remediationComplete
              ? S.cashRunway.remediationComplete[locale]
              : S.cashRunway.usdContracts(cliffStatus.usdDenominated)[locale]}
          </span>
          {cliffDays !== null ? (
            <span className="pill border-border text-neutral-400">
              {cliffDays >= 0
                ? S.cashRunway.cliffIn(cliffDays)[locale]
                : S.cashRunway.cliffPast(Math.abs(cliffDays))[locale]}
            </span>
          ) : null}
        </div>
        <p className="cockpit-card-meta">
          {S.cashRunway.postCliffSales(cliffStatus.postCliffSales)[locale]}
        </p>
      </div>
    </Card>
  );
}
