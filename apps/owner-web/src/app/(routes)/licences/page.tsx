import { PageHero } from '@/components/shared/PageHero';
import { LicencesList } from '@/components/licences/LicencesList';
import { LicenceHeroActions } from '@/components/licences/LicenceHeroActions';
import { getOwnerSession } from '@/lib/session';

/**
 * Licences index. Pulls every PML / ML / SML the active tenant holds
 * from `GET /api/v1/mining/licences`, classifies each row by expiry
 * window, and renders a dense filterable table with status pills.
 * Clicking a row routes into the per-licence cockpit drawer at
 * `/licence?id=...`.
 *
 * The hero strip surfaces the Mining Commission renewal CTA so an
 * owner who lands on the index with an expiring licence has the
 * primary action one click away.
 */
export default async function LicencesIndexPage() {
  const session = await getOwnerSession();
  return (
    <div className="space-y-8 px-8 py-8">
      <PageHero
        slug="licences"
        initialLocale={session.languagePreference}
        actions={<LicenceHeroActions locale={session.languagePreference} />}
      />
      <LicencesList locale={session.languagePreference} />
    </div>
  );
}
