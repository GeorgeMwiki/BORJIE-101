import { Nav } from '@/components/Nav';
import { Hero } from '@/components/Hero';
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
import { getLocale } from '@/lib/locale';

/**
 * Marketing home — section order mirrors the LitFin / Linear / Mercury
 * 2026 fintech-SaaS rhythm a mining operator's eye now expects:
 *
 *   00  Nav                    — top nav with bilingual toggle
 *   01  Hero                   — autopilot-mining-operations promise
 *   02  TrustStrip             — regulator + infra word-wall
 *   03  CapabilitiesGrid       — six core mining capabilities (Solution)
 *   04  HowItWorks             — three-step adoption arc
 *   05  HeadBriefingDemo       — what a 06:00 brief feels like
 *   06  AskShowcase            — "What's my cash runway?" mock
 *   07  StatsBand              — by-the-numbers pilot telemetry
 *   08  AutonomyDialDemo       — Advise → Autonomous, red-lines locked
 *   09  AuditChainSection      — every action on the chain
 *   10  LoopValidatorSection   — OODA Loop validator-gap, closed by design
 *   11  Pricing                — Mwanzo · Mkulima · Mfanyabiashara · Kampuni · Group
 *   12  Testimonial            — three pilot placeholders
 *   13  FinalCta               — full-bleed closing band, dual CTA
 *   14  Footer                 — four-column links + Tanzanian locale tag
 *
 * Editorial moves we mirror from the LitFin pattern:
 *   1.  Hero ≤ 7-word declarative; subhead one sentence with concrete
 *       outcomes (royalty returns, gold-window hedge, audit chain).
 *   2.  Single-row trust strip right under the hero — words not logos.
 *   3.  Mono-numeral stats band where headline numerals are display-
 *       weight tabular-nums; labels are mono-caption uppercase.
 *   4.  "Most chosen" pricing badge on the central tier with hairline
 *       gold ring and signal-glow card shadow.
 *   5.  Full-bleed final CTA band with aurora behind, dual CTA, and
 *       microcopy underneath that defuses cost objections.
 */
export default async function HomePage() {
  const locale = await getLocale();
  return (
    <>
      <Nav locale={locale} />
      <main id="main-content">
        <Hero locale={locale} />
        <TrustStrip locale={locale} />
        <CapabilitiesGrid locale={locale} />
        <HowItWorks locale={locale} />
        <HeadBriefingDemo locale={locale} />
        <AskShowcase locale={locale} />
        <StatsBand locale={locale} />
        <AutonomyDialDemo locale={locale} />
        <AuditChainSection locale={locale} />
        <LoopValidatorSection locale={locale} />
        <Pricing locale={locale} />
        <Testimonial locale={locale} />
        <FinalCta locale={locale} />
      </main>
      <Footer locale={locale} />
    </>
  );
}
