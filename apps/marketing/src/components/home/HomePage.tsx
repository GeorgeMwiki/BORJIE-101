/**
 * HomePage — LitFin canonical pattern. The marketing page.tsx composes
 * four top-level pieces: IgnitionHero, BrainClaimsBanner, CapabilitiesSection,
 * HomePage. This component is `HomePage` — the lazy-loaded fold of inner
 * sections. Mirrors:
 *
 *   LITFIN_PATH/src/components/home/HomePage.tsx
 *
 * Borjie keeps each inner section as its own polished impl (already
 * LitFin-cloned in prior waves — sibling #75 / #82 / #117 / #122). This
 * shell:
 *   1. Opens with the FrontierBanner (above-fold of HomePage — eager).
 *   2. Renders the "Why a Mining OS?" Problem/Solution duo (eager).
 *   3. Wraps below-fold sections in `LazyVisible` (IntersectionObserver
 *      gate, 400px ahead) so framer-motion-heavy sections never enter
 *      the first-paint payload.
 *
 * The 4-component LitFin marketing composition is:
 *   <IgnitionHero />            // hero + Live Fabric chat
 *   <BrainClaimsBanner />       // evidence-backed claims band
 *   <CapabilitiesSection />     // six capabilities tilt-grid
 *   <HomePage />                // everything below (this file)
 *
 * Note: LitFin's source uses next/dynamic() + Suspense for code-split
 * chunks. Borjie achieves the same first-paint goal through
 * IntersectionObserver-gated LazyVisible — chunks load when the
 * sentinel intersects, framer-motion never parses ahead of need. The
 * trade-off (less type-safety on dynamic strings vs simpler static
 * imports) was decided in favour of static imports for build-time TS
 * cleanliness under nodenext module resolution.
 */
'use client';

import type { Locale } from '@/lib/i18n';
import { SectionSkeleton } from '@/components/SectionSkeleton';
import { LazyVisible } from '@/components/LazyVisible';
import { ProblemSolution } from '@/components/sections/ProblemSolution';
import { UniversalAccessSection } from '@/components/sections/UniversalAccessSection';
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
  return (
    <div className="overflow-x-hidden">
      {/* ABOVE-FOLD of HomePage — eager */}
      <ProblemSolution locale={locale} />

      {/* ──────────────────────────────────────────────────────────
          BELOW-FOLD — each section gated by LazyVisible
          (IntersectionObserver 400px ahead). The skeleton holds
          a vertical-space placeholder so we don't shift layout
          before the section enters the viewport.
          ────────────────────────────────────────────────────────── */}
      <LazyVisible
        placeholderClassName="min-h-[520px]"
        fallback={<SectionSkeleton minHeight={520} cards={3} />}
      >
        <UniversalAccessSection locale={locale} />
      </LazyVisible>

      <LazyVisible
        placeholderClassName="min-h-[480px]"
        fallback={<SectionSkeleton minHeight={480} cards={3} />}
      >
        <PlatformShowcaseSection locale={locale} />
      </LazyVisible>

      <LazyVisible
        placeholderClassName="min-h-[520px]"
        fallback={<SectionSkeleton minHeight={520} cards={3} />}
      >
        <Pricing locale={locale} />
      </LazyVisible>

      <LazyVisible
        placeholderClassName="min-h-[480px]"
        fallback={<SectionSkeleton minHeight={480} cards={4} />}
      >
        <RoadmapCTASection locale={locale} />
      </LazyVisible>
    </div>
  );
}
