'use client';
/**
 * BorjieWidgetMount — marketing-site (anonymous) wrapper around the
 * @borjie/chat-ui LitFin-style floating widget.
 *
 * Renders the floating "Mr. Mwikila, AI Mining Managing Director"
 * bubble across every marketing page. Uses the `public`
 * portal — talks to /api/chat (a Next route handler that adapts the
 * widget shape to the Borjie api-gateway's /api/v1/public/chat
 * endpoint).
 *
 * Persona: "Mr. Mwikila, AI Mining Managing Director"
 * (the mining-estate brain layer: licences, royalty, workforce,
 * compliance, offtake).
 *
 * SOTA lazy-load
 * --------------
 * The widget is loaded via `next/dynamic({ ssr: false })` so the
 * entire `@borjie/chat-ui` bundle is excluded from the server-render
 * module graph. ChatPanel itself is further lazy-loaded by LitFinWidget
 * via next/dynamic so the heavy chat surface never enters the
 * critical-path JS payload.
 */
import dynamic from 'next/dynamic';
import { useEffect } from 'react';
import type { ReactNode, JSX } from 'react';

const LitFinAIProvider = dynamic(
  () =>
    import('@borjie/chat-ui').then((m) => ({
      default: m.LitFinAIProvider,
    })),
  { ssr: false },
);

const LitFinWidget = dynamic(
  () =>
    import('@borjie/chat-ui').then((m) => ({ default: m.LitFinWidget })),
  { ssr: false },
);

interface BorjieWidgetMountProps {
  readonly locale?: 'en' | 'sw';
}

/**
 * Borjie mining-domain compliance copy. The actor here is the mine
 * owner / licence holder. We pin "mine owner" in the disclaimer so an
 * unrelated edit (or a sibling chat-ui session targeting a different
 * domain) cannot revert it to a generic counterparty.
 */
const BORJIE_DISCLAIMER_EN =
  'AI-generated. Not legal advice. Decisions are made by the mine owner.';
const BORJIE_DISCLAIMER_SW =
  'AI-iliyotengenezwa. Si ushauri wa kisheria. Maamuzi yanafanywa na mmiliki wa mgodi.';

/**
 * The shared page-locale cookie that `@borjie/chat-ui`'s
 * `useWidgetLanguage()` treats as the single source of truth. The
 * marketing layout resolves the active locale server-side and passes it
 * down as `locale`; we mirror it into the cookie synchronously on the
 * client so the widget's first post-mount read finds the SAME value the
 * server rendered with — closing the one-EN-frame split-brain on `sw`
 * pages for embeddings where the cookie was not already set.
 *
 * The EN-frame is now fully eliminated, not just narrowed: `LitFinWidget`
 * takes an `initialLocale` prop (forwarded below) that SEEDS
 * `useWidgetLanguage('en', initialLocale)`, so the FAB's very first
 * synchronous render already matches the server-resolved locale. The cookie
 * mirror remains as the shared page-locale source of truth for the chat panel
 * (opened post-mount) and for embeddings where the cookie was not pre-set.
 */
const PAGE_LOCALE_COOKIE = 'borjie_locale';

function seedPageLocaleCookie(locale: 'en' | 'sw'): void {
  if (typeof document === 'undefined') return;
  const maxAge = 60 * 60 * 24 * 365;
  document.cookie = `${PAGE_LOCALE_COOKIE}=${encodeURIComponent(locale)}; path=/; max-age=${maxAge}; samesite=lax`;
}

export function BorjieWidgetMount({
  locale = 'en',
}: BorjieWidgetMountProps = {}): JSX.Element {
  // Mirror the server-resolved locale into the shared page-locale cookie
  // before the widget's post-mount language read runs.
  useEffect(() => {
    seedPageLocaleCookie(locale);
  }, [locale]);

  return (
    <LitFinAIProvider
      portalId="public"
      endpoint="/api/chat"
      initialRoute="/"
      disclaimerEn={BORJIE_DISCLAIMER_EN}
      disclaimerSw={BORJIE_DISCLAIMER_SW}
      autoOpen
    >
      <LitFinWidget initialLocale={locale} />
    </LitFinAIProvider>
  );
}

export function BorjieWidgetSlot({
  children,
}: {
  readonly children: ReactNode;
}): JSX.Element {
  return <>{children}</>;
}
