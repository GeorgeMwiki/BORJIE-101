import Link from 'next/link';
import { ArrowRight, MapPin } from 'lucide-react';
import { PageHero } from '@/components/shared/PageHero';
import { SitesList } from '@/components/sites/SitesList';
import { getOwnerSession } from '@/lib/session';

/**
 * Sites index — owner-side. Lists every physical mining site under
 * the active tenant; clicking a row links into the site cockpit.
 *
 * Page shell is a server component; the list is a client island
 * pulling `GET /api/v1/mining/sites` via `useSitesList`.
 */
export default async function SitesIndexPage() {
  const session = await getOwnerSession();
  const isSw = session.languagePreference === 'sw';
  return (
    <div className="space-y-8 px-8 py-8">
      <PageHero
        slug="sites"
        actions={
          <Link
            href="/portfolio-map"
            className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-xs font-semibold text-foreground hover:bg-surface"
          >
            <MapPin className="h-3.5 w-3.5" />
            {isSw ? 'Onyesha ramani' : 'Open portfolio map'}
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        }
      />
      <SitesList locale={session.languagePreference} />
    </div>
  );
}
