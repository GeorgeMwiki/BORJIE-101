import { Nav } from '@/components/Nav';
import { Hero } from '@/components/Hero';
import { CapabilitiesGrid } from '@/components/CapabilitiesGrid';
import { HowItWorks } from '@/components/HowItWorks';
import { HeadBriefingDemo } from '@/components/HeadBriefingDemo';
import { AskShowcase } from '@/components/AskShowcase';
import { AutonomyDialDemo } from '@/components/AutonomyDialDemo';
import { AuditChainSection } from '@/components/AuditChainSection';
import { Pricing } from '@/components/Pricing';
import { Testimonial } from '@/components/Testimonial';
import { Footer } from '@/components/Footer';
import { getLocale } from '@/lib/locale';

/**
 * Marketing home — twelve sections stitched in the order an interested
 * mining operator would read them:
 *
 *   00  Nav                    — top nav with bilingual toggle
 *   01  Hero                   — what Borjie IS, one sentence
 *   02  CapabilitiesGrid       — six core mining capabilities
 *   03  HowItWorks             — three-step adoption arc
 *   04  HeadBriefingDemo       — what a 06:00 brief feels like
 *   05  AskShowcase            — "What's my cash runway?" mock
 *   06  AutonomyDialDemo       — Advise → Autonomous, red-lines locked
 *   07  AuditChainSection      — every action on the chain
 *   08  Pricing                — Mwanzo · Mkulima · Mfanyabiashara · Kampuni · Group
 *   09  Testimonial            — three pilot placeholders
 *   10  Footer                 — links + Tanzanian locale tag
 */
export default async function HomePage() {
  const locale = await getLocale();
  return (
    <>
      <Nav locale={locale} />
      <main id="main-content">
        <Hero locale={locale} />
        <CapabilitiesGrid locale={locale} />
        <HowItWorks locale={locale} />
        <HeadBriefingDemo locale={locale} />
        <AskShowcase locale={locale} />
        <AutonomyDialDemo locale={locale} />
        <AuditChainSection locale={locale} />
        <Pricing locale={locale} />
        <Testimonial locale={locale} />
      </main>
      <Footer locale={locale} />
    </>
  );
}
