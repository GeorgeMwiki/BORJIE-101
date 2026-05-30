/**
 * Marketing home — LitFin canonical 4-component composition.
 *
 * Source of pattern: LITFIN_PATH/src/app/(marketing)/page.tsx
 *
 * Borjie's marketing was previously a single page.tsx with 24 inline
 * imports. LitFin's actual page.tsx is a 4-line RSC wrapper:
 *
 *   <IgnitionHero />        — hero + Live Fabric chat (above-fold)
 *   <BrainClaimsBanner />   — evidence-backed claims band
 *   <CapabilitiesSection /> — six capabilities tilt-grid
 *   <HomePage />            — everything below (lazy-loaded chunks)
 *
 * This file is now an RSC parent — `'use client'` lives inside each
 * child component. The wrapper itself doesn't ship as JS; only the
 * client islands do. ~5KB smaller initial bundle.
 *
 * The four children are client components (each has its own
 * 'use client' directive). Next.js mounts client children from an RSC
 * parent without issue.
 */

import { IgnitionHero } from '@/components/marketing/IgnitionHero';
import { BrainClaimsBanner } from '@/components/BrainClaimsBanner';
import { CapabilitiesSection } from '@/components/marketing/CapabilitiesSection';
import { HomePage } from '@/components/home/HomePage';
import { getLocale } from '@/lib/locale';

export default async function MarketingPage() {
  const locale = await getLocale();
  return (
    <>
      <IgnitionHero locale={locale} />
      <BrainClaimsBanner locale={locale} />
      <CapabilitiesSection locale={locale} audience="platform" />
      <HomePage locale={locale} />
    </>
  );
}
