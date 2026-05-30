'use client';
/**
 * BorjieWidgetMount — marketing-site (anonymous) wrapper around the
 * @borjie/chat-ui LitFin-style floating widget.
 *
 * Renders the floating "Mr. Mwikila — Borjie's AI Estate-Management
 * Director" bubble across every marketing page. Uses the `public`
 * portal — talks to /api/chat (a Next route handler that adapts the
 * widget shape to the Borjie api-gateway's /api/v1/public/chat
 * endpoint).
 *
 * Persona: "Mr. Mwikila — Borjie's AI Estate-Management Director"
 * (covers both real-estate and mining).
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
 * Borjie mining-domain compliance copy. Owners of mines are NOT
 * landlords — the BossNyumba real-estate variant says "landlord". We
 * pin "mine owner" here so an unrelated edit (or a sibling chat-ui
 * session targeting the property domain) cannot revert it.
 */
const BORJIE_DISCLAIMER_EN =
  'AI-generated. Not legal advice. Decisions are made by the mine owner.';
const BORJIE_DISCLAIMER_SW =
  'AI-iliyotengenezwa . Si ushauri wa kisheria . Maamuzi yanafanywa na mmiliki wa mgodi';

export function BorjieWidgetMount(
  _props: BorjieWidgetMountProps = {},
): JSX.Element {
  return (
    <LitFinAIProvider
      portalId="public"
      endpoint="/api/chat"
      initialRoute="/"
      disclaimerEn={BORJIE_DISCLAIMER_EN}
      disclaimerSw={BORJIE_DISCLAIMER_SW}
    >
      <LitFinWidget />
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
