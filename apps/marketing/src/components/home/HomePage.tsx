/**
 * HomePage — the below-the-hero fold of the marketing home.
 *
 * The marketing page.tsx composes:
 *   <IgnitionHero />            — hero + Live Fabric chat
 *   <CapabilitiesSection />     — six capabilities tilt-grid
 *   <HomePage />                — everything below (this file)
 *
 * All sections render EAGERLY. The previous IntersectionObserver-gated
 * `LazyVisible` shell was removed (PR drive-to-zero): the savings were
 * tiny and any hydration hiccup left blank panels mid-page.
 */
'use client';

import type { Locale } from '@/lib/i18n';
import { ProblemSolution } from '@/components/sections/ProblemSolution';
import { PlatformShowcaseSection } from '@/components/sections/PlatformShowcaseSection';
import { RoadmapCTASection } from '@/components/sections/RoadmapCTASection';
import { Pricing } from '@/components/Pricing';

export interface HomePageProps {
  readonly locale: Locale;
}

/**
 * HomePage — the below-the-hero fold of the marketing home.
 *
 * Condensed to the doctrine-9b canonical shape (capability-led, one
 * scroll): the hero + capability grid live in page.tsx; this file holds
 * the spine that earns its place —
 *
 *   ProblemSolution        — the "why": the real operator pains Borjie closes
 *   UniversalAccessSection — Swahili-first, phone/tablet/desktop (real edge)
 *   PlatformShowcaseSection — the one show-don't-tell product moment
 *   Pricing                — real plans
 *   RoadmapCTASection      — the single closing CTA
 *
 * The earlier build stacked thirteen sections (frontier banner, ecosystem
 * logo wall, seven-mode tabs, "three doors" meta-section, bento grid, and
 * an insights band carrying invented telemetry + named-operator quotes).
 * Those restated the hero, buried the message, or made unsourced claims,
 * so they were cut from the scroll. The deep per-segment detail now lives
 * on the /for-* audience pages, not stacked here.
 */
export function HomePage({ locale }: HomePageProps): JSX.Element {
  // Render every below-fold section eagerly. The previous LazyVisible
  // (IntersectionObserver) gates saved a little first-paint JS but at the cost
  // of ROBUSTNESS — any hydration hiccup left 3 large blank panels mid-page.
  // The sections are small + below the fold, so direct rendering is the right
  // trade: no possibility of blank gaps, and Next still code-splits the route.
  return (
    <div className="overflow-x-hidden">
      <ProblemSolution locale={locale} />
      <PlatformShowcaseSection locale={locale} />
      <Pricing locale={locale} />
      <RoadmapCTASection locale={locale} />
    </div>
  );
}
