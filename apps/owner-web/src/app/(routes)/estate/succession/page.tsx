import { PageHero } from '@/components/shared/PageHero';
import { SuccessionPanel } from '@/components/estate/SuccessionPanel';
import { getOwnerSession } from '@/lib/session';

/**
 * O-W-30 — Succession.
 *
 * Succession plan card per estate group with next-review-due chip and
 * a "Generate draft will" affordance that hands off to the existing
 * document-drafter.
 *
 * Live data path:
 *   GET /api/v1/estate/succession-plans
 */
export default async function EstateSuccessionPage(): Promise<JSX.Element> {
  const session = await getOwnerSession();
  return (
    <div className="space-y-8 px-8 py-8">
      <PageHero slug="estate/succession" />
      <SuccessionPanel locale={session.languagePreference} />
    </div>
  );
}
