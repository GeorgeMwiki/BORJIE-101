import { Suspense } from 'react';
import { getOwnerSession } from '@/lib/session';
import { HomeChat } from '@/components/home-chat/HomeChat';

/**
 * Owner-web home (/) — chat-first surface.
 *
 * Pivot 2026-05-27: the home was previously the cockpit dashboard
 * (CockpitGrid). The cockpit is preserved at `/cockpit` for direct
 * access from the sidebar; `/` now opens a conversational surface with
 * a persona greeting, suggestion chips, and a side panel that renders
 * the orchestrator's tool calls.
 *
 * Server boundary: this page resolves the owner session on the server
 * so identity / tenant / language preference are available without a
 * client-side waterfall. The chat surface itself is a client island
 * (`HomeChat`) because it owns react-query state and the brain wire.
 *
 * Suspense wrapping: `HomeChat` calls `useSearchParams` (for `?thread=`
 * deep links) which Next.js 15 requires to live inside a Suspense
 * boundary. The fallback is intentionally tiny so the page paints
 * instantly — the persona greeting + composer arrive on next tick.
 */
export default async function HomePage() {
  const session = await getOwnerSession();
  return (
    <Suspense fallback={<HomeChatFallback />}>
      <HomeChat
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
