import { Suspense } from 'react';
import { getOwnerSession } from '@/lib/session';
import { HomeChatTeach } from '@/components/home-chat/HomeChatTeach';

/**
 * Owner-web home (/) — chat-first teaching surface.
 *
 * Pivot 2026-05-27: the home was previously the cockpit dashboard
 * (CockpitGrid). The cockpit is preserved at `/cockpit` for direct
 * access from the sidebar; `/` now opens a conversational surface that
 * teaches the owner how to run their mine end-to-end.
 *
 * 2026-05-27 SURPASS pivot: the home now uses HomeChatTeach which
 * streams from /api/v1/brain/teach — the Borjie teaching register that
 * surpasses LitFin's /api/chat/exploration on five vectors:
 *   1. Multi-block teaching (one primary block + up to 2 inline_metric)
 *   2. 5-step lesson ladder (orient → licence → royalty → workforce
 *      → marketplace) tracked across turns
 *   3. Strategic-intent layer (ASSESS / TEACH / EXECUTE / SUMMARIZE)
 *   4. Tenant-grounded examples (owner's real tenantId + name in the
 *      <owner_context> envelope)
 *   5. Mandatory citation chain validated against the same whitelist
 *      as the marketing chat.
 *
 * The legacy `/turn`-driven HomeChat surface still ships in
 * `components/home-chat/HomeChat.tsx` for any callers that need the
 * tool-calling persona-runtime side panel.
 *
 * Server boundary: this page resolves the owner session on the server
 * so identity / tenant / language preference are available without a
 * client-side waterfall. The chat surface itself is a client island
 * (`HomeChatTeach`) because it owns the SSE wire.
 */
export default async function HomePage() {
  const session = await getOwnerSession();
  return (
    <Suspense fallback={<HomeChatFallback />}>
      <HomeChatTeach
        salutation={session.salutation}
        tradingName={session.tenant.tradingName}
        languagePreference={session.languagePreference}
      />
    </Suspense>
  );
}

function HomeChatFallback() {
  return (
    <div
      className="mx-auto my-12 max-w-xl rounded-lg border border-border bg-surface/40 p-6 text-sm text-neutral-400"
      data-testid="home-chat-fallback"
    >
      Loading Borjie…
    </div>
  );
}
