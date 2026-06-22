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
import { Skeleton } from '@borjie/design-system';
import { RefreshButton } from '@/components/shared/RefreshButton';
import { EmptyState } from '@/components/shared/EmptyState';
import { fmtTime } from '@/lib/format';
import { useLocale, pickByLocale, type Locale } from '@/lib/locale';
import { cockpitClusterStrings as S } from '@/i18n/strings/cockpit-cluster';

interface CockpitGridProps {
  /**
   * Server-resolved locale, threaded from the cockpit page so the
   * locale-aware DailyBriefCard SEEDS its first client render to the active
   * language (no EN-under-SW split-brain frame).
   */
  readonly initialLocale?: Locale;
}

/**
 * Owner-cockpit grid — 10 cards wired to the daily-brief query.
 *
 * Shows a stale-while-revalidate snapshot: last-updated timestamp,
 * refresh button, and a subtle pulse during background refetch. The
 * grid is LIVE-ONLY: on load it shows a skeleton, on failure an honest
 * error state with retry (no fabricated data), and on success the cards.
 */
export function CockpitGrid({ initialLocale }: CockpitGridProps = {}) {
  const locale = useLocale(initialLocale);
  const query = useDailyBrief();
  const data = query.data;
  // Honest error state — no more infinite skeleton when the brief fails.
  if (query.isError && !data) {
    return (
      <EmptyState
        title={pickByLocale(locale, S.grid.errorTitle)}
        description={
          (query.error as Error)?.message ??
          pickByLocale(locale, S.grid.errorBody)
        }
        hint="GET /api/v1/mining/cockpit/daily-brief"
        action={
          <RefreshButton
            onClick={() => query.refetch()}
            busy={query.isFetching}
          />
        }
      />
    );
  }
  if (!data) {
    return (
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 10 }).map((_, i) => (
          <Skeleton
            key={i}
            className="h-32 rounded-lg border border-border"
          />
        ))}
      </div>
    );
  }
  return (
    <>
      <div className="mb-4 flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {pickByLocale(locale, S.grid.updatedAt(fmtTime(data.updatedAt)))}
          {query.isFetching
            ? ` · ${pickByLocale(locale, S.grid.refreshing)}`
            : ''}
        </span>
        <RefreshButton onClick={() => query.refetch()} busy={query.isFetching} />
      </div>
      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <DailyBriefCard items={data.dailyBrief} language={initialLocale} />
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
