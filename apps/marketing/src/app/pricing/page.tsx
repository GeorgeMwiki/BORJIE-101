import type { Metadata } from 'next';
import { Check, Minus } from 'lucide-react';
import { Pricing } from '@/components/Pricing';
import { FinalCta } from '@/components/FinalCta';
import { FaqAccordion } from '@/components/shared/FaqAccordion';
import { TrustBadgeStrip } from '@/components/shared/TrustBadgeStrip';
import { getLocale } from '@/lib/locale';
import { getMessages } from '@/lib/i18n';
import { buildSegmentMetadata } from '@/components/marketing/segment-metadata';
import { TIERS, tierFeatures } from '@/lib/pricing';

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const t = getMessages(locale).pageMeta.pricing;
  return buildSegmentMetadata({
    path: '/pricing',
    locale,
    title: t.metaTitle,
    description: t.metaDescription,
  });
}

/**
 * /pricing , full pricing page.
 *
 * Hero ribbon (centered, single-column header) -> Pricing cards
 * (shared component) -> trust-badge wordwall -> feature comparison
 * matrix -> FAQ accordion -> closing CTA -> FinalCta band -> Footer.
 * Mirrors the LitFin pricing-page rhythm (sections S5 / S7 / S6 /
 * S18 / S19 / S15) section-for-section.
 */
export default async function PricingPage() {
  const locale = await getLocale();
  const t = getMessages(locale).pricingPage;

  // Feature-comparison matrix: union of all distinct features across
  // tiers, sorted in registration order, so the grid is stable.
  const allFeatures = Array.from(
    new Set(TIERS.flatMap((tier) => tierFeatures(tier, locale))),
  );

  return (
    <>
      
      <div>
        <section
          className="relative overflow-hidden"
          aria-labelledby="pricing-page-heading"
        >
          <div className="hero-aurora" aria-hidden="true" />
          <div className="absolute inset-0 cinematic-grid opacity-30" aria-hidden="true" />
          <div className="relative mx-auto max-w-3xl px-6 py-20 text-center lg:py-28">
            <p className="font-mono text-xs uppercase tracking-widest text-signal-500">
              {t.kicker}
            </p>
            <h1
              id="pricing-page-heading"
              className="mt-5 font-display text-5xl font-semibold tracking-tight text-balance sm:text-6xl"
            >
              {t.heading}
            </h1>
            <p className="mx-auto mt-6 max-w-prose-widest text-lg leading-relaxed text-foreground/70 sm:text-xl">
              {t.sub}
            </p>
          </div>
        </section>

        <Pricing locale={locale} />

        {/* TRUST BADGE STRIP , LitFin S6 */}
        <section
          className="mx-auto max-w-4xl px-6 pb-12 pt-4 text-center lg:px-8"
          aria-label="Trust badges"
        >
          <p className="mx-auto mb-6 max-w-xl font-mono text-xs uppercase tracking-widest text-foreground/60">
            {t.trustBadgesHeading}
          </p>
          <TrustBadgeStrip items={t.trustBadges} />
        </section>

        <section
          className="mx-auto max-w-7xl px-6 pb-24 lg:px-8"
          aria-labelledby="pricing-compare-heading"
        >
          <div className="mx-auto max-w-3xl text-center">
            <h2
              id="pricing-compare-heading"
              className="font-display text-3xl font-semibold tracking-tight"
            >
              {t.compareHeading}
            </h2>
            <p className="mx-auto mt-3 max-w-prose-wider text-base leading-relaxed text-foreground/70">
              {t.compareSub}
            </p>
          </div>

          <div className="mt-12 overflow-x-auto rounded-2xl border border-border bg-surface shadow-md">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-raised">
                  <th className="px-5 py-4 text-left font-mono text-caption uppercase tracking-widest text-foreground/70">
                    {t.featureColumn}
                  </th>
                  {TIERS.map((tier) => (
                    <th
                      key={tier.id}
                      className="px-5 py-4 text-center font-display text-sm font-medium tracking-tight text-foreground"
                    >
                      {tier.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {allFeatures.map((feature) => (
                  <tr key={feature} className="border-b border-border last:border-b-0">
                    <td className="px-5 py-3.5 text-left text-foreground">{feature}</td>
                    {TIERS.map((tier) => {
                      const has = tierFeatures(tier, locale).includes(feature);
                      return (
                        <td key={tier.id} className="px-5 py-3.5 text-center">
                          {has ? (
                            <Check className="mx-auto h-4 w-4 text-signal-500" aria-label="included" />
                          ) : (
                            <Minus className="mx-auto h-3.5 w-3.5 text-foreground/30" aria-label="not included" />
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* FAQ , LitFin S19 */}
        <section
          className="mx-auto max-w-3xl px-6 pb-24 lg:px-8"
          aria-labelledby="pricing-faq-heading"
        >
          <div className="text-center">
            <p className="font-mono text-xs uppercase tracking-widest text-signal-500">
              {t.faqKicker}
            </p>
            <h2
              id="pricing-faq-heading"
              className="mt-3 font-display text-3xl font-semibold tracking-tight text-balance sm:text-4xl"
            >
              {t.faqHeading}
            </h2>
            <p className="mx-auto mt-3 max-w-prose-wider text-base leading-relaxed text-foreground/70">
              {t.faqSub}
            </p>
          </div>
          <div className="mt-12">
            <FaqAccordion items={t.faqs} />
          </div>
        </section>

        <FinalCta locale={locale} />
      </div>
      
    </>
  );
}
