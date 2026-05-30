'use client';

/**
 * MarketingWidgetSlot — LitFin RSC pattern.
 *
 * Thin client island wrapper around the Borjie floating chat widget so
 * the marketing layout can stay RSC. The widget itself is already
 * client-side and lazy-mounts the heavy chat-ui bundle via
 * `next/dynamic({ ssr: false })` inside BorjieWidgetMount. Wrapping it
 * here keeps the layout boundary clean and surface-name aligned with
 * LitFin's MarketingWidgetSlot.
 *
 * Source of pattern: LITFIN_PATH/src/components/marketing/MarketingWidgetSlot.tsx
 * Source of impl:    apps/marketing/src/components/BorjieWidgetMount.tsx
 */

import { BorjieWidgetMount } from '@/components/BorjieWidgetMount';
import type { Locale } from '@/lib/i18n';

export interface MarketingWidgetSlotProps {
  readonly locale?: Locale;
}

export function MarketingWidgetSlot({
  locale = 'sw',
}: MarketingWidgetSlotProps): JSX.Element {
  return <BorjieWidgetMount locale={locale} />;
}
