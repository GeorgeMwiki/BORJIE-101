'use client';

import { useDailyBrief } from '@/lib/queries/cockpit';
import { DailyBriefCard } from './DailyBriefCard';
import { CashRunwayCard } from './CashRunwayCard';
import { LicenceHealthCard } from './LicenceHealthCard';
import { ProductionCard } from './ProductionCard';
import { OpenRisksCard } from './OpenRisksCard';
import { PendingDecisionsCard } from './PendingDecisionsCard';
import { ActiveSitesCard } from './ActiveSitesCard';
import { ComplianceCard } from './ComplianceCard';
import { MarketplaceCard } from './MarketplaceCard';
import { FxGoldCard } from './FxGoldCard';
import { RefreshButton } from '@/components/shared/RefreshButton';
import { fmtTime } from '@/lib/format';

/**
 * Owner-cockpit grid — 10 cards wired to the daily-brief query.
 *
 * Shows a stale-while-revalidate snapshot: last-updated timestamp,
 * refresh button, and a subtle pulse during background refetch. The
 * underlying useDailyBrief() falls back to the bundled mock so the
 * grid never blanks even when the gateway is unreachable.
 */
export function CockpitGrid() {
  const query = useDailyBrief();
  const data = query.data;
  if (!data) {
    return (
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 10 }).map((_, i) => (
          <div
            key={i}
            className="h-32 animate-pulse rounded-lg border border-border bg-surface/40"
          />
        ))}
      </div>
    );
  }
  return (
    <>
      <div className="mb-4 flex items-center justify-between text-xs text-neutral-500">
        <span>
          Updated {fmtTime(data.updatedAt)}
          {query.isFetching ? ' · refreshing…' : ''}
        </span>
        <RefreshButton onClick={() => query.refetch()} busy={query.isFetching} />
      </div>
      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <DailyBriefCard items={data.dailyBrief} />
        <CashRunwayCard
          cashTzsMillions={data.cashTzsMillions}
          runwayDays={data.runwayDays}
          burnPerDayTzsMillions={data.burnPerDayTzsMillions}
        />
        <LicenceHealthCard
          active={data.licences.active}
          renewalsDue60d={data.licences.renewalsDue60d}
          dormancyFlags={data.licences.dormancyFlags}
        />
        <ProductionCard
          grammesToday={data.production.grammesToday}
          grammesTargetToday={data.production.grammesTargetToday}
          grammesMtd={data.production.grammesMtd}
          grammesTargetMtd={data.production.grammesTargetMtd}
        />
        <OpenRisksCard items={data.openRisks} />
        <PendingDecisionsCard items={data.pendingDecisions} />
        <ActiveSitesCard items={data.activeSites} />
        <ComplianceCard
          green={data.compliance.green}
          amber={data.compliance.amber}
          red={data.compliance.red}
        />
        <MarketplaceCard
          openOffers={data.marketplace.openOffers}
          newInquiries7d={data.marketplace.newInquiries7d}
          topBuyer={data.marketplace.topBuyer}
        />
        <FxGoldCard
          goldSpotUsdOz={data.fxAndGold.goldSpotUsdOz}
          tzsUsd={data.fxAndGold.tzsUsd}
          sellWindowOpen={data.fxAndGold.sellWindowOpen}
          daysToCliff27Mar={data.fxAndGold.daysToCliff27Mar}
        />
      </section>
    </>
  );
}
