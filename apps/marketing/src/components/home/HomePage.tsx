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
 *   3. Lazy-loads the rest via next/dynamic — each section ships as its
 *      own chunk so the initial paint stays slim.
 *   4. Wraps below-fold chunks in `LazyVisible` (IntersectionObserver
 *      gate, 400px ahead) so framer-motion-heavy sections never enter
 *      the first-paint payload.
 *
 * The 4-component LitFin marketing composition is:
 *   <IgnitionHero />            // hero + Live Fabric chat
 *   <BrainClaimsBanner />       // evidence-backed claims band
 *   <CapabilitiesSection />     // six capabilities tilt-grid
 *   <HomePage />                // everything below (this file)
 */
'use client';

import dynamic from 'next/dynamic';
import { Suspense } from 'react';
import type { Locale } from '@/lib/i18n';
import { SectionSkeleton } from '@/components/SectionSkeleton';
import { LazyVisible } from '@/components/LazyVisible';
import { FrontierBanner } from '@/components/sections/FrontierBanner';
import { ProblemSolution } from '@/components/sections/ProblemSolution';

// PERF: Below-fold sections each ship as their own chunk so the initial
// HomePage payload only includes the two above-fold sections + the
// dynamic-import shims. Mirrors LitFin's iter-46 PERF wave.

const EcosystemSection = dynamic(
  () =>
    import('@/components/sections/EcosystemSection').then((m) => ({
      default: m.EcosystemSection,
    })),
  { loading: () => <SectionSkeleton minHeight={520} cards={3} /> },
);

const UniversalAccessSection = dynamic(
  () =>
    import('@/components/sections/UniversalAccessSection').then((m) => ({
      default: m.UniversalAccessSection,
    })),
  { loading: () => <SectionSkeleton minHeight={520} cards={3} /> },
);

const MwikilaModesSection = dynamic(
  () =>
    import('@/components/sections/MwikilaModesSection').then((m) => ({
      default: m.MwikilaModesSection,
    })),
  { loading: () => <SectionSkeleton minHeight={560} cards={3} /> },
);

const InteractiveModesSection = dynamic(
  () =>
    import('@/components/sections/InteractiveModesSection').then((m) => ({
      default: m.InteractiveModesSection,
    })),
  { loading: () => <SectionSkeleton minHeight={520} cards={3} /> },
);

const PlatformShowcaseSection = dynamic(
  () =>
    import('@/components/sections/PlatformShowcaseSection').then((m) => ({
      default: m.PlatformShowcaseSection,
    })),
  { loading: () => <SectionSkeleton minHeight={480} cards={3} /> },
);

const BentoGrid = dynamic(
  () =>
    import('@/components/sections/BentoGrid').then((m) => ({
      default: m.BentoGrid,
    })),
  { loading: () => <SectionSkeleton minHeight={420} cards={4} /> },
);

const InsightsAndScaleSection = dynamic(
  () =>
    import('@/components/sections/InsightsAndScaleSection').then((m) => ({
      default: m.InsightsAndScaleSection,
    })),
  { loading: () => <SectionSkeleton minHeight={520} cards={3} /> },
);

const RoadmapCTASection = dynamic(
  () =>
    import('@/components/sections/RoadmapCTASection').then((m) => ({
      default: m.RoadmapCTASection,
    })),
  { loading: () => <SectionSkeleton minHeight={480} cards={4} /> },
);

const Pricing = dynamic(
  () => import('@/components/Pricing').then((m) => ({ default: m.Pricing })),
  { loading: () => <SectionSkeleton minHeight={520} cards={3} /> },
);

export interface HomePageProps {
  readonly locale: Locale;
}

export function HomePage({ locale }: HomePageProps): JSX.Element {
  return (
    <div className="overflow-x-hidden">
      {/* ABOVE-FOLD of HomePage — eager */}
      <FrontierBanner locale={locale} />
      <ProblemSolution locale={locale} />

      {/* ──────────────────────────────────────────────────────────
          BELOW-FOLD — each section ships as its own dynamic chunk.
          Suspense fallbacks preserve streaming so the skeleton
          appears before the lazy chunk arrives. The deeper sections
          additionally wait on `LazyVisible` (IntersectionObserver
          400px ahead) so we don't pay framer-motion parse cost
          until the user actually scrolls near them.
          ────────────────────────────────────────────────────────── */}
      <Suspense fallback={<SectionSkeleton minHeight={520} cards={3} />}>
        <EcosystemSection locale={locale} />
      </Suspense>

      <Suspense fallback={<SectionSkeleton minHeight={520} cards={3} />}>
        <UniversalAccessSection locale={locale} />
      </Suspense>

      <Suspense fallback={<SectionSkeleton minHeight={560} cards={3} />}>
        <MwikilaModesSection locale={locale} />
      </Suspense>

      <Suspense fallback={<SectionSkeleton minHeight={520} cards={3} />}>
        <InteractiveModesSection locale={locale} />
      </Suspense>

      <LazyVisible placeholderClassName="min-h-[420px]">
        <Suspense fallback={<SectionSkeleton minHeight={420} cards={4} />}>
          <BentoGrid locale={locale} />
        </Suspense>
      </LazyVisible>

      <LazyVisible placeholderClassName="min-h-[480px]">
        <Suspense fallback={<SectionSkeleton minHeight={480} cards={3} />}>
          <PlatformShowcaseSection locale={locale} />
        </Suspense>
      </LazyVisible>

      <LazyVisible placeholderClassName="min-h-[520px]">
        <Suspense fallback={<SectionSkeleton minHeight={520} cards={3} />}>
          <InsightsAndScaleSection locale={locale} />
        </Suspense>
      </LazyVisible>

      <LazyVisible placeholderClassName="min-h-[520px]">
        <Suspense fallback={<SectionSkeleton minHeight={520} cards={3} />}>
          <Pricing locale={locale} />
        </Suspense>
      </LazyVisible>

      <LazyVisible placeholderClassName="min-h-[480px]">
        <Suspense fallback={<SectionSkeleton minHeight={480} cards={4} />}>
          <RoadmapCTASection locale={locale} />
        </Suspense>
      </LazyVisible>
    </div>
  );
}
