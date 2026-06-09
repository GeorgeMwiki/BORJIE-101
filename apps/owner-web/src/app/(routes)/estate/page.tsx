/**
 * O-W-27 — Estate overview.
 *
 * Family-office shell. The MetricStrip is populated client-side via
 * EstateMetricStrip (a 'use client' island) which fans out to the four
 * estate aggregate endpoints in parallel so the server component stays
 * simple and each metric loads independently without blocking the page.
 *
 * Live data paths:
 *   GET /api/v1/estate/groups          — entity count
 *   GET /api/v1/estate/assets          — total asset value TZS
 *   GET /api/v1/estate/capital-movements?limit=1 — 30-day capital flows
 *   GET /api/v1/estate/succession-plans — succession plan count
 */

import { PageHero } from '@/components/shared/PageHero';
import { EstateOverview } from '@/components/estate/EstateOverview';
import { EstateMetricStrip } from '@/components/estate/EstateMetricStrip';
import { getOwnerSession } from '@/lib/session';

export default async function EstateOverviewPage(): Promise<JSX.Element> {
  const session = await getOwnerSession();
  return (
    <div className="space-y-8 px-8 py-8">
      <PageHero slug="estate" />
      <EstateMetricStrip locale={session.languagePreference} />
      <EstateOverview locale={session.languagePreference} />
    </div>
  );
}
