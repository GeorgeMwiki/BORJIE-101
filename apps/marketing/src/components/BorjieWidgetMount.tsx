'use client';
/**
 * BorjieWidgetMount — marketing-site (anonymous) wrapper around the
 * @borjie/chat-ui FloatingAskBorjie widget.
 *
 * Renders the floating "Mr. Mwikila — Borjie's AI Mining Operations Manager" bubble
 * across every marketing page. Uses the public/anonymous variant — talks
 * to /api/v1/public/chat which serves curated Borjie-about-Borjie
 * responses (no tenant data, no auth required).
 */
import { FloatingAskBorjie } from '@borjie/chat-ui';

interface BorjieWidgetMountProps {
  readonly locale?: 'en' | 'sw';
}

export function BorjieWidgetMount({ locale = 'en' }: BorjieWidgetMountProps): JSX.Element {
  return (
    <FloatingAskBorjie
      variant="public"
      initialLanguage={locale}
      apiBaseUrl={process.env.NEXT_PUBLIC_API_GATEWAY_URL ?? ''}
    />
  );
}
