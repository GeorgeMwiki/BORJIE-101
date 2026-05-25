import { getOwnerSession } from '@/lib/session';
import { COCKPIT_MOCK } from '@/lib/cockpit-mocks';
import { DailyBriefCard } from '@/components/cockpit/DailyBriefCard';
import { CashRunwayCard } from '@/components/cockpit/CashRunwayCard';
import { LicenceHealthCard } from '@/components/cockpit/LicenceHealthCard';
import { ProductionCard } from '@/components/cockpit/ProductionCard';
import { OpenRisksCard } from '@/components/cockpit/OpenRisksCard';
import { PendingDecisionsCard } from '@/components/cockpit/PendingDecisionsCard';
import { ActiveSitesCard } from '@/components/cockpit/ActiveSitesCard';
import { ComplianceCard } from '@/components/cockpit/ComplianceCard';
import { MarketplaceCard } from '@/components/cockpit/MarketplaceCard';
import { FxGoldCard } from '@/components/cockpit/FxGoldCard';

/**
 * O-W-01 — Owner cockpit dashboard.
 *
 * 10 cards per BOJI_AI_SPEC §13: daily brief, cash & runway, licence
 * health, production vs target, open risks, pending decisions, active
 * sites, compliance status, marketplace activity, FX & gold window.
 *
 * Data is mocked for now via `cockpit-mocks.ts`. When the gateway is
 * wired, swap the import for a single `loadCockpitSnapshot(session)`
 * call against api-sdk — the cards stay unchanged.
 */
export default async function CockpitHomePage() {
  const session = await getOwnerSession();
  const c = COCKPIT_MOCK;

  return (
    <div className="px-8 py-8">
      <header className="mb-8">
        <h1 className="font-display text-3xl text-foreground">
          Habari za asubuhi, {session.salutation}.
        </h1>
        <p className="mt-1 text-sm text-neutral-400">
          {session.tenant.legalName} · {session.tenant.region} ·{' '}
          {session.sites.length} sites · plan: {session.tenant.plan}
        </p>
      </header>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <DailyBriefCard items={c.dailyBrief} />
        <CashRunwayCard
          cashTzsMillions={c.cashTzsMillions}
          runwayDays={c.runwayDays}
          burnPerDayTzsMillions={c.burnPerDayTzsMillions}
        />
        <LicenceHealthCard
          active={c.licences.active}
          renewalsDue60d={c.licences.renewalsDue60d}
          dormancyFlags={c.licences.dormancyFlags}
        />
        <ProductionCard
          grammesToday={c.production.grammesToday}
          grammesTargetToday={c.production.grammesTargetToday}
          grammesMtd={c.production.grammesMtd}
          grammesTargetMtd={c.production.grammesTargetMtd}
        />
        <OpenRisksCard items={c.openRisks} />
        <PendingDecisionsCard items={c.pendingDecisions} />
        <ActiveSitesCard items={c.activeSites} />
        <ComplianceCard
          green={c.compliance.green}
          amber={c.compliance.amber}
          red={c.compliance.red}
        />
        <MarketplaceCard
          openOffers={c.marketplace.openOffers}
          newInquiries7d={c.marketplace.newInquiries7d}
          topBuyer={c.marketplace.topBuyer}
        />
        <FxGoldCard
          goldSpotUsdOz={c.fxAndGold.goldSpotUsdOz}
          tzsUsd={c.fxAndGold.tzsUsd}
          sellWindowOpen={c.fxAndGold.sellWindowOpen}
          daysToCliff27Mar={c.fxAndGold.daysToCliff27Mar}
        />
      </section>
    </div>
  );
}
