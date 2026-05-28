import Link from 'next/link';
import { MapPin, Sparkles } from 'lucide-react';
import { PageHero } from '@/components/shared/PageHero';
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
  const isSw = session.languagePreference === 'sw';
  const activeSite = session.sites.find((s) => s.id === session.activeSiteId);
  return (
    <div className="space-y-8 px-8 py-8">
      <PageHero
        slug="site-cockpit"
        actions={
          <>
            <Link
              href="/sites"
              className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-xs font-semibold text-foreground hover:bg-surface"
            >
              <MapPin className="h-3.5 w-3.5" />
              {isSw ? 'Badilisha mgodi' : 'Switch site'}
            </Link>
            <Link
              href="/ask?prompt=site-cockpit"
              className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-xs font-semibold text-foreground hover:bg-surface"
            >
              <Sparkles className="h-3.5 w-3.5" />
              {isSw ? 'Uliza kuhusu mgodi' : 'Ask about this site'}
            </Link>
          </>
        }
        meta={
          activeSite ? (
            <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-surface/40 px-4 py-3 text-xs">
              <span className="text-neutral-500">
                {isSw ? 'Mgodi unaonyeshwa' : 'Active site'}
              </span>
              <span className="font-medium text-foreground">
                {activeSite.name}
              </span>
              <span className="text-neutral-500">
                {activeSite.region} - {activeSite.mineral} -{' '}
                <span className="capitalize">{activeSite.status}</span>
              </span>
            </div>
          ) : null
        }
      />
      <SiteCockpitSurface siteId={session.activeSiteId} />
    </div>
  );
}
