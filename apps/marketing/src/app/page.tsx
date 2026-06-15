/**
 * Marketing home — condensed to the capability-led canonical shape:
 *
 *   <IgnitionHero />        — one value prop + supporting line + one CTA
 *   <CapabilitiesSection /> — the six real capabilities, verb+object
 *   <HomePage />            — problem/solution, bilingual edge, product
 *                            moment, pricing, single closing CTA
 *
 * This file is an RSC parent — `'use client'` lives inside each child
 * component, so only the client islands ship JS. The earlier build also
 * rendered a BrainClaimsBanner here; it carried unsourced figures and was
 * removed.
 */

import { IgnitionHero } from '@/components/marketing/IgnitionHero';
import { CapabilitiesSection } from '@/components/marketing/CapabilitiesSection';
import { HomePage } from '@/components/home/HomePage';
import { getLocale } from '@/lib/locale';

export default async function MarketingPage() {
  const locale = await getLocale();
  return (
    <>
      <IgnitionHero locale={locale} />
      <CapabilitiesSection locale={locale} audience="platform" />
      <HomePage locale={locale} />
    </>
  );
}
