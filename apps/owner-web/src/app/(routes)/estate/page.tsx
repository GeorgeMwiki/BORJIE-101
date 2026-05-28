import { Briefcase, Building2, Coins, Scroll } from 'lucide-react';
import { PageHero } from '@/components/shared/PageHero';
import { MetricStrip } from '@/components/shared/MetricStrip';
import { EstateOverview } from '@/components/estate/EstateOverview';
import { getOwnerSession } from '@/lib/session';

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
            label: isSw ? 'Kampuni' : 'Entities',
            value: '—',
            icon: Building2,
            sub: isSw
              ? 'Jumla ya kampuni hai kwenye miliki'
              : 'Active entities under the estate',
          },
          {
            label: isSw ? 'Thamani ya mali' : 'Asset value',
            value: '—',
            icon: Briefcase,
            sub: isSw ? 'TZS, jumla ya mali' : 'TZS, total estate assets',
          },
          {
            label: isSw ? 'Mtiririko (siku 30)' : 'Capital flows (30d)',
            value: '—',
            icon: Coins,
            sub: isSw ? 'TZS, mtiririko wa siku 30' : 'TZS, last 30 days',
          },
          {
            label: isSw ? 'Hali ya urithi' : 'Succession status',
            value: '—',
            icon: Scroll,
            sub: isSw
              ? 'Hatua za mapitio yanayohitajika'
              : 'Plans pending review',
          },
        ]}
      />
      <EstateOverview locale={session.languagePreference} />
    </div>
  );
}
