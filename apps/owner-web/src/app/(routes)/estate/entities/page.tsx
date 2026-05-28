import { PageHero } from '@/components/shared/PageHero';
import { EntitiesList } from '@/components/estate/EntitiesList';
import { getOwnerSession } from '@/lib/session';

/**
 * O-W-28 — Estate entities.
 *
 * Lists every business under the estate group with kind, ownership
 * percentage, and lifecycle status. Click a row to drill into the
 * detail (lands in a follow-up wave alongside the entity drawer).
 *
 * Live data path:
 *   GET /api/v1/estate/entities
 */
export default async function EstateEntitiesPage(): Promise<JSX.Element> {
  const session = await getOwnerSession();
  return (
    <div className="space-y-8 px-8 py-8">
      <PageHero slug="estate/entities" />
      <EntitiesList locale={session.languagePreference} />
    </div>
  );
}
