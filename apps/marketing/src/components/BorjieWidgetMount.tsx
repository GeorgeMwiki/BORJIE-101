'use client';
/**
 * BorjieWidgetMount — marketing-site (anonymous) wrapper around the
 * @borjie/chat-ui FloatingAskBorjie widget.
 *
 * Renders the floating "Mr. Mwikila — Borjie's AI Mining Managing
 * Director" bubble across every marketing page. Uses the public/anonymous
 * variant — talks to /api/v1/public/chat which serves curated
 * Borjie-about-Borjie responses (no tenant data, no auth required).
 *
 * SOTA lazy-load (Wave 15H)
 * --------------------------
 * The widget is loaded via `next/dynamic({ ssr: false })` so the entire
 * `@borjie/chat-ui` bundle is excluded from the server-render module
 * graph. Three wins:
 *   1. SSR is faster — no chat-ui parse/eval on the server.
 *   2. Smaller SSR JS payload — none of chat-ui's transitive deps ship
 *      in the initial HTML.
 *   3. Defense in depth — even if a future chat-ui dep adds a
 *      `typeof window` access at module-load, SSR can't see it.
 *
 * Trade-off: the widget is invisible on the initial server render,
 * then hydrates client-side. The floating bubble appears within a
 * single animation frame after hydration (FCP-safe).
 */
import dynamic from 'next/dynamic';

const FloatingAskBorjie = dynamic(
  () => import('@borjie/chat-ui').then((m) => m.FloatingAskBorjie),
  { ssr: false },
);

interface BorjieWidgetMountProps {
  readonly locale?: 'en' | 'sw';
}

export function BorjieWidgetMount({
  locale = 'en',
}: BorjieWidgetMountProps): JSX.Element {
  return (
    <FloatingAskBorjie
      variant="public"
      initialLanguage={locale}
      apiBaseUrl={process.env.NEXT_PUBLIC_API_GATEWAY_URL ?? ''}
    />
  );
}
