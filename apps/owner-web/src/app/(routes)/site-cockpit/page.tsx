import { ScreenHeader } from '@/components/ScreenHeader';
import { SiteCockpitSurface } from '@/components/site-cockpit/SiteCockpitSurface';
import { getOwnerSession } from '@/lib/session';

/**
 * O-W-06 — Site cockpit.
 *
 * Three tabs: Shift (latest shift card, blockers list, photo gallery),
 * Geology (composite score gauge + 30-day trend), Cost (unit-economics
 * table with all-in TZS/g and trend arrows). Site selection comes from
 * the top-bar SiteSelector via session.activeSiteId.
 */
export default async function SiteCockpitPage() {
  const session = await getOwnerSession();
  return (
    <>
      <ScreenHeader slug="site-cockpit" />
      <div className="px-8 py-6">
        <SiteCockpitSurface siteId={session.activeSiteId} />
      </div>
    </>
  );
}
