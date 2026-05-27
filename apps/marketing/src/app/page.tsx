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
import { FinalCta } from '@/components/FinalCta';
import { Footer } from '@/components/Footer';
import { StaggerReveal } from '@/components/animations/StaggerReveal';
import { getLocale } from '@/lib/locale';

/**
 * Marketing home — Borjie's Live Fabric page flow.
 *
 * Section order, top-to-bottom:
 *   00  Nav
 *   01  Hero                   — Live Fabric two-column (claim + chat)
 *   02  BrainClaimsBanner      — rotating evidence-backed claims
 *   03  TrustStrip
 *   04  CapabilitiesGrid       — tilt cards, six capabilities
 *   05  HowItWorks
 *   06  HeadBriefingDemo
 *   07  AskShowcase
 *   08  StatsBand              — numerals count up on scroll
 *   09  AutonomyDialDemo
 *   10  AuditChainSection
 *   11  LoopValidatorSection
 *   12  Pricing
 *   13  Testimonial
 *   14  FinalCta
 *   15  Footer
 *
 * Each section beyond the hero is wrapped in StaggerReveal so the
 * children fade up 8px with a 60ms stagger as the band crosses the
 * viewport. The hero itself orchestrates its own choreography.
 */
export default async function HomePage() {
  const locale = await getLocale();
  return (
    <>
      <Nav locale={locale} />
      <main id="main-content">
        <Hero locale={locale} />
        <BrainClaimsBanner locale={locale} />
        <StaggerReveal>
          <TrustStrip locale={locale} />
        </StaggerReveal>
        <StaggerReveal>
          <CapabilitiesGrid locale={locale} />
        </StaggerReveal>
        <StaggerReveal>
          <HowItWorks locale={locale} />
        </StaggerReveal>
        <StaggerReveal>
          <HeadBriefingDemo locale={locale} />
        </StaggerReveal>
        <StaggerReveal>
          <AskShowcase locale={locale} />
        </StaggerReveal>
        <StaggerReveal>
          <StatsBand locale={locale} />
        </StaggerReveal>
        <StaggerReveal>
          <AutonomyDialDemo locale={locale} />
        </StaggerReveal>
        <StaggerReveal>
          <AuditChainSection locale={locale} />
        </StaggerReveal>
        <StaggerReveal>
          <LoopValidatorSection locale={locale} />
        </StaggerReveal>
        <StaggerReveal>
          <Pricing locale={locale} />
        </StaggerReveal>
        <StaggerReveal>
          <Testimonial locale={locale} />
        </StaggerReveal>
        <StaggerReveal>
          <FinalCta locale={locale} />
        </StaggerReveal>
      </main>
      <Footer locale={locale} />
    </>
  );
}
