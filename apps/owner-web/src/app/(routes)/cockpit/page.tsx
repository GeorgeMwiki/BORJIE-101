import { getOwnerSession } from '@/lib/session';
import { CockpitGrid } from '@/components/cockpit/CockpitGrid';

/**
 * O-W-01 — Cockpit dashboard.
 *
 * Pivot 2026-05-27: home (`/`) is now chat-first, so the 10-card
 * cockpit lives here. Behaviour is identical to the pre-pivot home —
 * server-side session resolution + `<CockpitGrid />` client island
 * with stale-while-revalidate snapshots and a refresh button.
 */
export default async function CockpitPage() {
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
