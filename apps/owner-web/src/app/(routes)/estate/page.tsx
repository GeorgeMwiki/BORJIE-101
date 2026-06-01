import { Briefcase, Building2, Coins, Scroll } from 'lucide-react';
import { PageHero } from '@/components/shared/PageHero';
import { MetricStrip } from '@/components/shared/MetricStrip';
import { EstateOverview } from '@/components/estate/EstateOverview';
import { getOwnerSession } from '@/lib/session';
import { routesAStrings as S } from '@/i18n/strings/routes-a';

/**
 * O-W-27 — Estate overview.
 *
 * Family-office shell. Top-level tile for every owner running a
 * mining-rooted business empire: total entity count, asset value
 * (TZS), 30-day capital flow, succession status. Tree view of
 * estate_entities below.
 *
 * Live data path:
 *   GET /api/v1/estate/groups
 *   GET /api/v1/estate/entities?tree=1
 *   GET /api/v1/estate/capital-movements?since=...
 *   GET /api/v1/estate/succession-plans
 */
export default async function EstateOverviewPage(): Promise<JSX.Element> {
  const session = await getOwnerSession();
  const isSw = session.languagePreference === 'sw';
  return (
    <div className="space-y-8 px-8 py-8">
      <PageHero slug="estate" />
      <MetricStrip
        cols={4}
        tiles={[
          {
            label: isSw ? S.estate.entitiesLabel.sw : S.estate.entitiesLabel.en,
            value: '—',
            icon: Building2,
            sub: isSw ? S.estate.entitiesSub.sw : S.estate.entitiesSub.en,
          },
          {
            label: isSw
              ? S.estate.assetValueLabel.sw
              : S.estate.assetValueLabel.en,
            value: '—',
            icon: Briefcase,
            sub: isSw ? S.estate.assetValueSub.sw : S.estate.assetValueSub.en,
          },
          {
            label: isSw
              ? S.estate.capitalFlowsLabel.sw
              : S.estate.capitalFlowsLabel.en,
            value: '—',
            icon: Coins,
            sub: isSw
              ? S.estate.capitalFlowsSub.sw
              : S.estate.capitalFlowsSub.en,
          },
          {
            label: isSw
              ? S.estate.successionLabel.sw
              : S.estate.successionLabel.en,
            value: '—',
            icon: Scroll,
            sub: isSw ? S.estate.successionSub.sw : S.estate.successionSub.en,
          },
        ]}
      />
      <EstateOverview locale={session.languagePreference} />
    </div>
  );
}
