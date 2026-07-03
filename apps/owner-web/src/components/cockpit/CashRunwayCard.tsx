'use client';

import { Card } from '@borjie/design-system';
import { formatMoneyMillions, LAUNCH_CURRENCY } from '@/lib/format';
import { useLocale } from '@/lib/locale';
import { StatusPill } from '@/components/shared/StatusPill';
import { financeTablesStrings as S } from '@/i18n/strings/finance-tables';

interface CashRunwayCardProps {
  readonly cashTzsMillions: number;
  /**
   * REAL runway (cash on hand ÷ net daily burn). `null` = unknown (missing
   * feed) or no-burn (net cash-positive); `runwayBurnStatus` tells them apart.
   * Never the degenerate constant 90.
   */
  readonly runwayDays: number | null;
  readonly runwayBurnStatus: 'burning' | 'no_burn' | 'unknown';
  readonly burnPerDayTzsMillions: number;
}

export function CashRunwayCard({
  cashTzsMillions,
  runwayDays,
  runwayBurnStatus,
  burnPerDayTzsMillions,
}: CashRunwayCardProps) {
  const locale = useLocale();
  // Net-positive (no burn) is healthy → green; a genuinely unknown runway
  // (missing feed) is neutral → amber; a finite runway is tiered by days.
  const runwayTone: 'green' | 'amber' | 'red' =
    runwayDays === null
      ? runwayBurnStatus === 'no_burn'
        ? 'green'
        : 'amber'
      : runwayDays >= 90
        ? 'green'
        : runwayDays >= 45
          ? 'amber'
          : 'red';
  const runwayLabel =
    runwayDays !== null
      ? S.cockpitCash.daysRunway(runwayDays)[locale]
      : runwayBurnStatus === 'no_burn'
        ? S.cashRunway.noBurn[locale]
        : S.cashRunway.runwayUnknown[locale];
  const money = (millions: number) =>
    formatMoneyMillions(millions, LAUNCH_CURRENCY);
  return (
    <Card hoverable className="p-5">
      <div className="cockpit-card-title">{S.cockpitCash.title[locale]}</div>
      <div className="cockpit-card-value">{money(cashTzsMillions)}</div>
      <div className="mt-2 flex items-center gap-2">
        <StatusPill tone={runwayTone} label={runwayLabel} />
      </div>
      {/* Burn line only when there is a real burn to report. */}
      {runwayBurnStatus === 'burning' && burnPerDayTzsMillions > 0 ? (
        <div className="cockpit-card-meta">
          {S.cockpitCash.burnPerDay(money(burnPerDayTzsMillions))[locale]}
        </div>
      ) : null}
    </Card>
  );
}
