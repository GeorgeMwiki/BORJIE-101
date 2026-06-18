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
      autoOpen
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
