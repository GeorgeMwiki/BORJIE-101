'use client';

import { Card } from '@borjie/design-system';

import { StatusPill } from '@/components/shared/StatusPill';
import { useLocale, pickByLocale } from '@/lib/locale';
import { cockpitClusterStrings as S } from '@/i18n/strings/cockpit-cluster';

interface ProductionCardProps {
  readonly grammesToday: number;
  readonly grammesTargetToday: number;
  readonly grammesMtd: number;
  readonly grammesTargetMtd: number;
}

function pct(value: number, target: number): number {
  if (target <= 0) return 0;
  return Math.round((value / target) * 100);
}

export function ProductionCard({
  grammesToday,
  grammesTargetToday,
  grammesMtd,
  grammesTargetMtd,
}: ProductionCardProps) {
  const locale = useLocale();
  const dayPct = pct(grammesToday, grammesTargetToday);
  const mtdPct = pct(grammesMtd, grammesTargetMtd);
  const dayTone: 'green' | 'amber' | 'red' =
    dayPct >= 100 ? 'green' : dayPct >= 85 ? 'amber' : 'red';
  return (
    <Card hoverable className="p-5">
      <div className="cockpit-card-title">
        {pickByLocale(locale, S.production.title)}
      </div>
      <div className="cockpit-card-value">
        {pickByLocale(locale, S.production.grammes(grammesToday.toLocaleString()))}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <StatusPill
          tone={dayTone}
          label={pickByLocale(locale, S.production.ofDayTarget(dayPct))}
        />
      </div>
      <div className="cockpit-card-meta">
        {pickByLocale(
          locale,
          S.production.mtd(
            grammesMtd.toLocaleString(),
            grammesTargetMtd.toLocaleString(),
            mtdPct,
          ),
        )}
      </div>
    </Card>
  );
}
