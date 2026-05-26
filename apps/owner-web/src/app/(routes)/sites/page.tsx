import { ScreenHeader } from '@/components/ScreenHeader';
import { SitesList } from '@/components/sites/SitesList';

/**
 * Sites index — owner-side. Lists every physical mining site under
 * the active tenant; clicking a row links into the site cockpit.
 *
 * Page shell is a server component; the list is a client island
 * pulling `GET /api/v1/mining/sites` via `useSitesList`.
 */
export default function SitesIndexPage() {
  return (
    <>
      <ScreenHeader slug="sites" />
      <div className="px-8 py-6">
        <SitesList />
      </div>
    </>
  );
}
