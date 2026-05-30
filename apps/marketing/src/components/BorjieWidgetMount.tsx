'use client';
/**
 * BorjieWidgetMount — marketing-site (anonymous) wrapper around the
 * Borjie floating Mr. Mwikila chat bubble.
 *
 * Mounts the LitFin-clone Widget (carbon-copy of LitFinWidget.tsx) wrapped
 * in BorjieAIProvider so the bubble can read route + language context and
 * page-level chat surfaces share the same UnifiedChat conversation.
 *
 * Persona: "Mr. Mwikila — Borjie's AI Estate-Management Director" (covers
 * both real-estate and mining). The widget talks to /api/v1/public/chat
 * which serves curated Borjie-about-Borjie responses (no tenant data, no
 * auth required).
 *
 * SOTA lazy-load
 * --------------
 * The widget is loaded via `next/dynamic({ ssr: false })` so the entire
 * `@borjie/chat-ui` widget bundle is excluded from the server-render
 * module graph. ChatPanel itself is further lazy-loaded by Widget.tsx
 * (via next/dynamic) so the heavy chat surface never enters the
 * critical-path JS payload.
 */
import dynamic from 'next/dynamic';
import { usePathname } from 'next/navigation';
import { BorjieAIProvider } from '@borjie/chat-ui';

const Widget = dynamic(
  () => import('@borjie/chat-ui').then((m) => ({ default: m.Widget })),
  { ssr: false },
);

interface BorjieWidgetMountProps {
  readonly locale?: 'en' | 'sw';
}

export function BorjieWidgetMount({
  locale = 'en',
}: BorjieWidgetMountProps): JSX.Element {
  const pathname = usePathname() ?? '/';
  const endpoint =
    (process.env.NEXT_PUBLIC_API_GATEWAY_URL ?? '') + '/api/v1/public/chat';
  return (
    <BorjieAIProvider
      portal="public"
      defaultPersona="public-chat"
      defaultLanguage={locale}
      currentPath={pathname}
      endpoint={endpoint}
    >
      <Widget />
    </BorjieAIProvider>
  );
}
