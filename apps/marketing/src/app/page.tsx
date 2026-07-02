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

import type { Metadata } from 'next';
import { IgnitionHero } from '@/components/marketing/IgnitionHero';
import { CapabilitiesSection } from '@/components/marketing/CapabilitiesSection';
import { HomePage } from '@/components/home/HomePage';
import { getLocale } from '@/lib/locale';
import { getMessages } from '@/lib/i18n';
import { buildSegmentMetadata } from '@/components/marketing/segment-metadata';

/**
 * Home-route metadata (SEO-L1/L3). Without its own generateMetadata the home
 * page inherits the layout canonical, so its `/sw` variant self-canonicalizes
 * to `/` (de-indexing the whole Swahili surface) and ships no en/sw/x-default
 * hreflang. `path: ''` is the canonical home form: `en` → the shared root URL,
 * `sw` → `/sw`, each self-referencing.
 */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const t = getMessages(locale).pageMeta.home;
  return buildSegmentMetadata({
    path: '',
    locale,
    title: t.metaTitle,
    description: t.metaDescription,
  });
}

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
