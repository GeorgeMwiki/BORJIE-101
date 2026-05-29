import { getOwnerSession } from '@/lib/session';
import { CockpitGrid } from '@/components/cockpit/CockpitGrid';
import { CockpitLivePulse } from '@/components/cockpit/CockpitLivePulse';

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
  const isSw = session.languagePreference === 'sw';
  const hour = new Date().getHours();
  const greeting = isSw
    ? hour < 12
      ? 'Habari za asubuhi'
      : hour < 17
        ? 'Habari za mchana'
        : 'Habari za jioni'
    : hour < 12
      ? 'Good morning'
      : hour < 17
        ? 'Good afternoon'
        : 'Good evening';
  const sitesLabel = isSw
    ? session.sites.length === 1
      ? 'mgodi 1'
      : `migodi ${session.sites.length}`
    : `${session.sites.length} sites`;
  const planLabel = isSw ? 'mpango' : 'plan';
  return (
    <div className="px-8 py-8">
      <header className="mb-8">
        <h1 className="font-display text-3xl text-foreground">
          {greeting}, {session.salutation}.
        </h1>
        <p className="mt-1 text-sm text-neutral-400">
          {session.tenant.legalName} · {session.tenant.region} ·{' '}
          {sitesLabel} · {planLabel}: {session.tenant.plan}
        </p>
      </header>
      {/* R6 — live cockpit SSE pulse. Opens an EventSource against
          /api/v1/cockpit/stream and toasts every push (6 event kinds). */}
      <CockpitLivePulse language={isSw ? 'sw' : 'en'} />
      <CockpitGrid />
    </div>
  );
}
