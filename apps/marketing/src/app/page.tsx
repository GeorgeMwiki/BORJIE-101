import { Nav } from '@/components/Nav';
import { Hero } from '@/components/Hero';
import { BrainClaimsBanner } from '@/components/BrainClaimsBanner';
import { TrustStrip } from '@/components/TrustStrip';
import { CapabilitiesGrid } from '@/components/CapabilitiesGrid';
import { HowItWorks } from '@/components/HowItWorks';
import { HeadBriefingDemo } from '@/components/HeadBriefingDemo';
import { AskShowcase } from '@/components/AskShowcase';
import { StatsBand } from '@/components/StatsBand';
import { AutonomyDialDemo } from '@/components/AutonomyDialDemo';
import { AuditChainSection } from '@/components/AuditChainSection';
import { LoopValidatorSection } from '@/components/LoopValidatorSection';
import { Pricing } from '@/components/Pricing';
import { Testimonial } from '@/components/Testimonial';
import { Footer } from '@/components/Footer';
import { LazyVisible } from '@/components/LazyVisible';
import { SectionSkeleton } from '@/components/SectionSkeleton';
import { StaggerReveal } from '@/components/animations/StaggerReveal';
import { FrontierBanner } from '@/components/sections/FrontierBanner';
import { ProblemSolution } from '@/components/sections/ProblemSolution';
import { EcosystemSection } from '@/components/sections/EcosystemSection';
import { UniversalAccessSection } from '@/components/sections/UniversalAccessSection';
import { MwikilaModesSection } from '@/components/sections/MwikilaModesSection';
import { InteractiveModesSection } from '@/components/sections/InteractiveModesSection';
import { PlatformShowcaseSection } from '@/components/sections/PlatformShowcaseSection';
import { BentoGrid } from '@/components/sections/BentoGrid';
import { InsightsAndScaleSection } from '@/components/sections/InsightsAndScaleSection';
import { RoadmapCTASection } from '@/components/sections/RoadmapCTASection';
import { getLocale } from '@/lib/locale';

/**
 * Marketing home — Borjie's LitFin-mirror page flow.
 *
 * Above-fold (eager, in initial JS payload):
 *   00  Nav
 *   01  Hero                    — Live Fabric two-column (sibling #73)
 *   02  BrainClaimsBanner       — evidence-backed claims (sibling #73)
 *   03  TrustStrip              — regulator + infra wordwall
 *   04  CapabilitiesGrid        — six capabilities (sibling #73 tilt cards)
 *   05  FrontierBanner          — kicker band before main below-fold flow
 *   06  ProblemSolution         — WHY-A-MINING-OS Problem/Solution duo
 *
 * Below-fold (LazyVisible, IntersectionObserver gate 400px ahead):
 *   07  EcosystemSection        — regulator + market + money-rails grid
 *   08  UniversalAccessSection  — bilingual sw/en + multi-device framing
 *   09  HowItWorks              — three-step adoption arc (kept)
 *   10  HeadBriefingDemo        — what a 06:00 brief feels like (kept)
 *   11  MwikilaModesSection     — 7-tab showcase of Mr. Mwikila modes
 *   12  AskShowcase             — "What's my cash runway?" mock (kept)
 *   13  InteractiveModesSection — Marketing chat · Home chat · Voice
 *   14  PlatformShowcaseSection — Owner Cockpit / Workforce / Marketplace
 *   15  BentoGrid               — 5-tile asymmetric feature grid
 *   16  StatsBand               — pilot telemetry (sibling #73)
 *   17  InsightsAndScaleSection — CountUp stats + pilot quote cards
 *   18  AutonomyDialDemo        — Advise → Autonomous (kept)
 *   19  AuditChainSection       — every action on the chain (kept)
 *   20  LoopValidatorSection    — OODA validator gates (kept)
 *   21  Pricing                 — Mwanzo · Mkulima · ... · Group
 *   22  Testimonial             — three pilot placeholders (kept)
 *   23  RoadmapCTASection       — closing band: roadmap pills, dual CTA
 *   24  Footer                  — 4-column LitFin footer
 *
 * Eager sections ship in the initial chunk. Everything below ladder
 * through LazyVisible so framer-motion-heavy sections never enter the
 * first-paint payload.
 */
export default async function HomePage() {
  const locale = await getLocale();
  return (
    <>
      <Nav locale={locale} />
      <main id="main-content">
        {/* Above-fold */}
        <Hero locale={locale} />
        <BrainClaimsBanner locale={locale} />
        <StaggerReveal>
          <TrustStrip locale={locale} />
        </StaggerReveal>
        <StaggerReveal>
          <CapabilitiesGrid locale={locale} />
        </StaggerReveal>
        <FrontierBanner locale={locale} />
        <ProblemSolution locale={locale} />

        {/* Below-fold — deferred to IntersectionObserver */}
        <LazyVisible placeholderClassName="min-h-[520px]">
          <EcosystemSection locale={locale} />
        </LazyVisible>
        <LazyVisible placeholderClassName="min-h-[480px]">
          <UniversalAccessSection locale={locale} />
        </LazyVisible>
        <LazyVisible placeholderClassName="min-h-[480px]">
          <HowItWorks locale={locale} />
        </LazyVisible>
        <LazyVisible placeholderClassName="min-h-[520px]">
          <HeadBriefingDemo locale={locale} />
        </LazyVisible>
        <LazyVisible
          placeholderClassName="min-h-[560px]"
          fallback={<SectionSkeleton minHeight={560} cards={3} />}
        >
          <MwikilaModesSection locale={locale} />
        </LazyVisible>
        <LazyVisible placeholderClassName="min-h-[480px]">
          <AskShowcase locale={locale} />
        </LazyVisible>
        <LazyVisible placeholderClassName="min-h-[520px]">
          <InteractiveModesSection locale={locale} />
        </LazyVisible>
        <LazyVisible placeholderClassName="min-h-[520px]">
          <PlatformShowcaseSection locale={locale} />
        </LazyVisible>
        <LazyVisible
          placeholderClassName="min-h-[600px]"
          fallback={<SectionSkeleton minHeight={600} cards={4} />}
        >
          <BentoGrid locale={locale} />
        </LazyVisible>
        <LazyVisible placeholderClassName="min-h-[320px]">
          <StatsBand locale={locale} />
        </LazyVisible>
        <LazyVisible
          placeholderClassName="min-h-[480px]"
          fallback={<SectionSkeleton minHeight={480} cards={3} />}
        >
          <InsightsAndScaleSection locale={locale} />
        </LazyVisible>
        <LazyVisible placeholderClassName="min-h-[480px]">
          <AutonomyDialDemo locale={locale} />
        </LazyVisible>
        <LazyVisible placeholderClassName="min-h-[480px]">
          <AuditChainSection locale={locale} />
        </LazyVisible>
        <LazyVisible placeholderClassName="min-h-[480px]">
          <LoopValidatorSection locale={locale} />
        </LazyVisible>
        <LazyVisible placeholderClassName="min-h-[520px]">
          <Pricing locale={locale} />
        </LazyVisible>
        <LazyVisible placeholderClassName="min-h-[400px]">
          <Testimonial locale={locale} />
        </LazyVisible>
        <LazyVisible placeholderClassName="min-h-[480px]">
          <RoadmapCTASection locale={locale} />
        </LazyVisible>
      </main>
      <Footer locale={locale} />
    </>
  );
}
