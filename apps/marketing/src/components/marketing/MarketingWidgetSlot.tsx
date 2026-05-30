'use client';

/**
 * MarketingWidgetSlot — LitFin RSC pattern.
 *
 * Thin client island wrapper around the Borjie floating chat widget so
 * the marketing layout can stay RSC. The widget itself is already
 * client-side; this slot exists so the layout boundary is a server
 * component (smaller initial bundle, layout shell streams from the
 * server without a hydration boundary).
 *
 * Source of pattern: LITFIN_PATH/src/components/marketing/MarketingWidgetSlot.tsx
 * Source of impl:    apps/marketing/src/components/BorjieWidgetMount.tsx
 */

import dynamic from 'next/dynamic';

const BorjieWidget = dynamic(() =>
  import('@/components/BorjieWidgetMount').then((m) => ({
    default: m.BorjieWidgetMount,
  })),
);

export function MarketingWidgetSlot({
  locale = 'sw',
}: {
  readonly locale?: 'sw' | 'en';
}): JSX.Element {
  return <BorjieWidget locale={locale} />;
}
