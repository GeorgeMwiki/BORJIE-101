import { getOwnerSession } from '@/lib/session';
import { CockpitGrid } from '@/components/cockpit/CockpitGrid';

/**
 * O-W-01 — Owner cockpit dashboard.
 *
 * The 10 cockpit cards are now wired to the daily-brief TanStack
 * query: stale-while-revalidate, last-updated timestamp, refresh
 * button. The grid itself is a client island; the page shell stays a
 * server component so session resolution happens on the server.
 */
export default async function CockpitHomePage() {
  const session = await getOwnerSession();
  return (
    <div className="px-8 py-8">
      <header className="mb-8">
        <h1 className="font-display text-3xl text-foreground">
          Habari za asubuhi, {session.salutation}.
        </h1>
        <p className="mt-1 text-sm text-neutral-400">
          {session.tenant.legalName} · {session.tenant.region} ·{' '}
          {session.sites.length} sites · plan: {session.tenant.plan}
        </p>
      </header>
      <CockpitGrid />
    </div>
  );
}
