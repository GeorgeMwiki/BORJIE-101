'use client';

import { Card } from '@borjie/design-system';
import { formatMoneyMillions, LAUNCH_CURRENCY } from '@/lib/format';
import { useLocale } from '@/lib/locale';
import { StatusPill } from '@/components/shared/StatusPill';
import { financeTablesStrings as S } from '@/i18n/strings/finance-tables';

interface CashRunwayCardProps {
  readonly cashTzsMillions: number;
  readonly runwayDays: number;
  readonly burnPerDayTzsMillions: number;
}

export function CashRunwayCard({
  cashTzsMillions,
  runwayDays,
  burnPerDayTzsMillions,
}: CashRunwayCardProps) {
  const locale = useLocale();
  const runwayTone: 'green' | 'amber' | 'red' =
    runwayDays >= 90 ? 'green' : runwayDays >= 45 ? 'amber' : 'red';
  const money = (millions: number) =>
    formatMoneyMillions(millions, LAUNCH_CURRENCY);
  return (
    <Card hoverable className="p-5">
      <div className="cockpit-card-title">{S.cockpitCash.title[locale]}</div>
      <div className="cockpit-card-value">{money(cashTzsMillions)}</div>
      <div className="mt-2 flex items-center gap-2">
        <StatusPill
          tone={runwayTone}
          label={S.cockpitCash.daysRunway(runwayDays)[locale]}
        />
      </div>
      <div className="cockpit-card-meta">
        {S.cockpitCash.burnPerDay(money(burnPerDayTzsMillions))[locale]}
      </div>
    </Card>
  );
}
