'use client';

import { Card } from '@borjie/design-system';

import { StatusPill } from '@/components/shared/StatusPill';
import { useLocale, pickByLocale } from '@/lib/locale';
import { cockpitClusterStrings as S } from '@/i18n/strings/cockpit-cluster';

interface FxGoldCardProps {
  readonly goldSpotUsdOz: number;
  readonly tzsUsd: number;
  readonly sellWindowOpen: boolean;
  readonly daysToCliff27Mar: number;
}

export function FxGoldCard({
  goldSpotUsdOz,
  tzsUsd,
  sellWindowOpen,
  daysToCliff27Mar,
}: FxGoldCardProps) {
  const locale = useLocale();
  // The cockpit endpoint does not source FX/gold; it returns 0 until the
  // dedicated fx feed is wired into this slot. Render an honest "feed not
  // wired" placeholder rather than a fabricated $0 /oz or TZS/USD 0.
  const hasGold = goldSpotUsdOz > 0;
  const hasTzsUsd = tzsUsd > 0;
  const perOz = pickByLocale(locale, S.fxGold.perOz);
  return (
    <Card hoverable className="p-5">
      <div className="cockpit-card-title">
        {pickByLocale(locale, S.fxGold.title)}
      </div>
      <div className="cockpit-card-value">
        {hasGold ? (
          <>
            ${goldSpotUsdOz.toLocaleString()}
            <span className="ml-1 text-base text-muted-foreground">{perOz}</span>
          </>
        ) : (
          <span className="text-muted-foreground">
            —<span className="ml-1 text-base">{perOz}</span>
          </span>
        )}
      </div>
      <div className="cockpit-card-meta">
        {hasTzsUsd
          ? pickByLocale(locale, S.fxGold.tzsUsd(tzsUsd.toLocaleString()))
          : pickByLocale(locale, S.fxGold.tzsUsdEmpty)}
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        <StatusPill
          tone={sellWindowOpen ? 'green' : 'amber'}
          label={pickByLocale(locale, S.fxGold.sellWindow(sellWindowOpen))}
        />
        <StatusPill
          tone={daysToCliff27Mar <= 30 ? 'red' : 'amber'}
          label={pickByLocale(locale, S.fxGold.cliff(daysToCliff27Mar))}
        />
      </div>
    </Card>
  );
}
