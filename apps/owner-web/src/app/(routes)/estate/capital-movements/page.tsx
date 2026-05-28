import { PageHero } from '@/components/shared/PageHero';
import { CapitalMovementsTimeline } from '@/components/estate/CapitalMovementsTimeline';
import { getOwnerSession } from '@/lib/session';

/**
 * O-W-29 — Capital flows.
 *
 * Chronological intercompany money flow log: dividends, intercompany
 * loans, capital injections, JV distributions, royalty settlements,
 * inheritance transfers, tax payments. A Sankey diagram showing inter-
 * entity flows lands in a follow-up wave; today this surface renders
 * a timeline plus a totals strip.
 *
 * Live data path:
 *   GET /api/v1/estate/capital-movements
 */
export default async function EstateCapitalMovementsPage(): Promise<JSX.Element> {
  const session = await getOwnerSession();
  return (
    <div className="space-y-8 px-8 py-8">
      <PageHero slug="estate/capital-movements" />
      <CapitalMovementsTimeline locale={session.languagePreference} />
    </div>
  );
}
