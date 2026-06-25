import { getOwnerSession } from '@/lib/session';
import { CockpitGrid } from '@/components/cockpit/CockpitGrid';
import { CockpitLivePulse } from '@/components/cockpit/CockpitLivePulse';
import { EstateLoadErrorNotice } from '@/components/cockpit/EstateLoadErrorNotice';
import { routesAStrings as S } from '@/i18n/strings/routes-a';

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
  const greet =
    hour < 12
      ? S.cockpit.greetMorning
      : hour < 17
        ? S.cockpit.greetAfternoon
        : S.cockpit.greetEvening;
  const greeting = isSw ? greet.sw : greet.en;
  const sitesLabel = isSw
    ? session.sites.length === 1
      ? S.cockpit.siteOne.sw
      : `${S.cockpit.sitesPluralNoun.sw} ${session.sites.length}`
    : `${session.sites.length} sites`;
  const planLabel = isSw ? S.cockpit.plan.sw : S.cockpit.plan.en;
  return (
    <div className="px-8 py-8">
      <header className="mb-8">
        <h1 className="font-display text-3xl text-foreground">
          {greeting}, {session.salutation}.
        </h1>
        {/* FAILURE vs EMPTINESS: when the estate/sites read FAILED, the
            sites count would lie as "0 sites" — drop it from the subline and
            render a retry affordance instead. A genuine empty estate (no
            error) keeps the honest count. */}
        {session.estateLoadError ? (
          <>
            <p className="mt-1 text-sm text-muted-foreground">
              {session.tenant.legalName} · {session.tenant.region} ·{' '}
              {planLabel}: {session.tenant.plan}
            </p>
            <EstateLoadErrorNotice initialLocale={session.languagePreference} />
          </>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground">
            {session.tenant.legalName} · {session.tenant.region} ·{' '}
            {sitesLabel} · {planLabel}: {session.tenant.plan}
          </p>
        )}
      </header>
      {/* R6 — live cockpit SSE pulse. Opens an EventSource against
          /api/v1/cockpit/stream and toasts every push (6 event kinds). */}
      <CockpitLivePulse language={isSw ? 'sw' : 'en'} />
      <CockpitGrid initialLocale={session.languagePreference} />
    </div>
  );
}
