import Link from 'next/link';
import { MapPin, Sparkles } from 'lucide-react';
import { PageHero } from '@/components/shared/PageHero';
import { SiteCockpitSurface } from '@/components/site-cockpit/SiteCockpitSurface';
import { getOwnerSession } from '@/lib/session';
import { routesBStrings as S } from '@/i18n/strings/routes-b';

interface SiteCockpitPageProps {
  readonly searchParams: Promise<{ readonly siteId?: string }>;
}

/**
 * O-W-06 — Site cockpit.
 *
 * Three tabs: Shift (latest shift card, blockers list, photo gallery),
 * Geology (composite score gauge + 30-day trend), Cost (unit-economics
 * table with all-in TZS/g and trend arrows). Site selection is driven by
 * the `?siteId=` query param (from the SiteSelector / deep links) and
 * falls back to the session's most-recent site when absent.
 */
export default async function SiteCockpitPage({
  searchParams,
}: SiteCockpitPageProps) {
  const session = await getOwnerSession();
  const isSw = session.languagePreference === 'sw';
  const { siteId: siteIdParam } = await searchParams;
  const siteId = siteIdParam?.trim() || session.activeSiteId;
  const activeSite = session.sites.find((s) => s.id === siteId);
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
              {isSw ? S.siteCockpit.switchSite.sw : S.siteCockpit.switchSite.en}
            </Link>
            <Link
              href="/ask?prompt=site-cockpit"
              className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-xs font-semibold text-foreground hover:bg-surface"
            >
              <Sparkles className="h-3.5 w-3.5" />
              {isSw ? S.siteCockpit.askAboutSite.sw : S.siteCockpit.askAboutSite.en}
            </Link>
          </>
        }
        meta={
          activeSite ? (
            <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-surface/40 px-4 py-3 text-xs">
              <span className="text-muted-foreground">
                {isSw ? S.siteCockpit.activeSite.sw : S.siteCockpit.activeSite.en}
              </span>
              <span className="font-medium text-foreground">
                {activeSite.name}
              </span>
              <span className="text-muted-foreground">
                {activeSite.region} - {activeSite.mineral} -{' '}
                <span className="capitalize">{activeSite.status}</span>
              </span>
            </div>
          ) : null
        }
      />
      {siteId ? (
        <SiteCockpitSurface siteId={siteId} />
      ) : (
        <div className="rounded-2xl border border-border bg-surface/40 px-6 py-12 text-center text-sm text-muted-foreground">
          {isSw ? S.siteCockpit.noSites.sw : S.siteCockpit.noSites.en}
        </div>
      )}
    </div>
  );
}
