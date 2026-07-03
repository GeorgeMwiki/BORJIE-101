'use client';

import { Card } from '@borjie/design-system';
import { formatMoney, formatLargeMoney, LAUNCH_CURRENCY } from '@/lib/format';
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
 * Shows the REAL cash runway (cash on hand ÷ net daily burn, computed by the
 * gateway from the treasury + cost ledgers) alongside the 90-day sales-inflow
 * signal and the post-27-Mar USD cliff tracker. The runway is honest: `null`
 * `runwayDays` renders "runway unknown" (inputs missing) or "no burn" (estate
 * net cash-positive) per `burnStatus` — NEVER the old degenerate constant 90.
 * Every string renders in the ACTIVE locale (no EN/SW mixing); money flows
 * through `formatMoney` with the launch currency as data.
 */
export function CashRunwayCard({
  cashRunway,
  cliffStatus,
  initialLocale,
}: CashRunwayCardProps): JSX.Element {
  const locale = useLocale(initialLocale);
  // REAL runway from the gateway — cash on hand ÷ net daily burn. `null` means
  // unknown (no treasury/cost feed) or no-burn (net cash-positive), told apart
  // by `burnStatus`. We do NOT re-derive a day count on the client.
  const runwayDays = cashRunway.runwayDays;
  const burnStatus = cashRunway.burnStatus;
  const cliff = new Date(cliffStatus.cliffDateIso);
  const cliffDays = Number.isNaN(cliff.getTime())
    ? null
    : Math.round((cliff.getTime() - Date.now()) / (24 * 60 * 60 * 1000));

  const runwayPill =
    runwayDays === null
      ? // Net-positive (no burn) is a healthy signal → green; a genuinely
        // unknown runway (missing feed) is neutral → amber.
        burnStatus === 'no_burn'
        ? 'pill-green'
        : 'pill-amber'
      : runwayDays >= 90
        ? 'pill-green'
        : runwayDays >= 45
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
          {runwayDays !== null
            ? S.cashRunway.daysRunway(runwayDays)[locale]
            : burnStatus === 'no_burn'
              ? S.cashRunway.noBurn[locale]
              : S.cashRunway.runwayUnknown[locale]}
        </span>
        {cashRunway.netDailyBurnTzs !== null &&
        cashRunway.netDailyBurnTzs > 0 ? (
          <span className="pill border-border text-neutral-400">
            {
              S.cashRunway.burnPerDay(
                formatLargeMoney(
                  cashRunway.netDailyBurnTzs,
                  LAUNCH_CURRENCY,
                  locale,
                ),
              )[locale]
            }
          </span>
        ) : null}
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
