'use client';

import { Card } from '@borjie/design-system';

import { StatusPill } from '@/components/shared/StatusPill';
import { useLocale, pickByLocale } from '@/lib/locale';
import { bcp47For } from '@/lib/format';
import { cockpitClusterStrings as S } from '@/i18n/strings/cockpit-cluster';

interface ProductionCardProps {
  readonly grammesToday: number;
  readonly grammesTargetToday: number | null;
  readonly grammesMtd: number;
  readonly grammesTargetMtd: number | null;
}

// `null` target → `null` pct (no target wired): render "target not set", never a
// fabricated 0% (which reads as RED / behind on a real production surface).
function pct(value: number, target: number | null): number | null {
  if (target == null || target <= 0) return null;
  return Math.round((value / target) * 100);
}

export function ProductionCard({
  grammesToday,
  grammesTargetToday,
  grammesMtd,
  grammesTargetMtd,
}: ProductionCardProps) {
  const locale = useLocale();
  const bcp47 = bcp47For(locale);
  const dayPct = pct(grammesToday, grammesTargetToday);
  const mtdPct = pct(grammesMtd, grammesTargetMtd);
  const dayTone: 'green' | 'amber' | 'red' | 'neutral' =
    dayPct === null
      ? 'neutral'
      : dayPct >= 100
        ? 'green'
        : dayPct >= 85
          ? 'amber'
          : 'red';
  return (
    <Card hoverable className="p-5">
      <div className="cockpit-card-title">
        {pickByLocale(locale, S.production.title)}
      </div>
      <div className="cockpit-card-value">
        {pickByLocale(locale, S.production.tonnes(grammesToday.toLocaleString(bcp47)))}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <StatusPill
          tone={dayTone}
          label={pickByLocale(
            locale,
            dayPct === null
              ? S.production.noTarget
              : S.production.ofDayTarget(dayPct),
          )}
        />
      </div>
      <div className="cockpit-card-meta">
        {pickByLocale(
          locale,
          mtdPct === null || grammesTargetMtd === null
            ? S.production.mtdNoTarget(grammesMtd.toLocaleString(bcp47))
            : S.production.mtd(
                grammesMtd.toLocaleString(bcp47),
                grammesTargetMtd.toLocaleString(bcp47),
                mtdPct,
              ),
        )}
      </div>
    </Card>
  );
}
