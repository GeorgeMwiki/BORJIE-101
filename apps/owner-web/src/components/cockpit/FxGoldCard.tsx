'use client';

import { Card } from '@borjie/design-system';

import { StatusPill } from '@/components/shared/StatusPill';
import { useLocale, pickByLocale } from '@/lib/locale';
import { formatMoney, bcp47For } from '@/lib/format';
import { cockpitClusterStrings as S } from '@/i18n/strings/cockpit-cluster';

/**
 * Gold is quoted in USD per troy ounce by the FX/gold feed (the prop is
 * `goldSpotUsdOz`). The ISO code is carried as data here — never a
 * hardcoded `'$'` symbol — so the render flows through `formatMoney`
 * (locale-aware, currency-display = ISO code) like every other money
 * surface in the cockpit.
 */
const GOLD_QUOTE_CURRENCY = 'USD';

/**
 * `null` for a quote means the `fx_rates` benchmark feed has not yet written
 * that pair — the gateway sends `null` (not a fabricated 0) so the card can
 * render an honest em-dash, distinguishing an empty feed from a real rate.
 */
interface FxGoldCardProps {
  readonly goldSpotUsdOz: number | null;
  readonly tzsUsd: number | null;
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
  const bcp47 = bcp47For(locale);
  // FX/gold comes from the live `fx_rates` feed; a pair the feed has not yet
  // written arrives as `null`. Guard with `Number.isFinite` (never `> 0` on a
  // possibly-null value) and render an honest "feed not wired" placeholder
  // rather than a fabricated $0 /oz or TZS/USD 0.
  const hasGold =
    typeof goldSpotUsdOz === 'number' &&
    Number.isFinite(goldSpotUsdOz) &&
    goldSpotUsdOz > 0;
  const hasTzsUsd =
    typeof tzsUsd === 'number' && Number.isFinite(tzsUsd) && tzsUsd > 0;
  // Pre-narrow into definite numbers so the JSX renders without a non-null
  // assertion (the booleans above already proved finiteness).
  const goldValue =
    hasGold && goldSpotUsdOz !== null
      ? formatMoney(goldSpotUsdOz, GOLD_QUOTE_CURRENCY, locale)
      : null;
  const tzsUsdText =
    hasTzsUsd && tzsUsd !== null ? tzsUsd.toLocaleString(bcp47) : null;
  const perOz = pickByLocale(locale, S.fxGold.perOz);
  return (
    <Card hoverable className="p-5">
      <div className="cockpit-card-title">
        {pickByLocale(locale, S.fxGold.title)}
      </div>
      <div className="cockpit-card-value">
        {goldValue !== null ? (
          <>
            {goldValue}
            <span className="ml-1 text-base text-muted-foreground">{perOz}</span>
          </>
        ) : (
          <span className="text-muted-foreground">
            —<span className="ml-1 text-base">{perOz}</span>
          </span>
        )}
      </div>
      <div className="cockpit-card-meta">
        {tzsUsdText !== null
          ? pickByLocale(locale, S.fxGold.tzsUsd(tzsUsdText))
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
