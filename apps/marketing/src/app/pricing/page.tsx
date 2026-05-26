import type { Metadata } from 'next';
import { Check } from 'lucide-react';
import { Nav } from '@/components/Nav';
import { Pricing } from '@/components/Pricing';
import { Footer } from '@/components/Footer';
import { getLocale } from '@/lib/locale';
import { getMessages } from '@/lib/i18n';
import { TIERS, tierFeatures } from '@/lib/pricing';

export const metadata: Metadata = {
  title: 'Pricing — Borjie',
  description:
    'Borjie pricing — Mwanzo (free) · Mkulima · Mfanyabiashara · Kampuni · Group. All tiers in TZS. Payable via M-Pesa, Tigo Pesa, Airtel Money, or bank transfer.',
};

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
      <Nav locale={locale} />
      <main id="main-content">
        <header className="mx-auto max-w-7xl px-6 pb-8 pt-20 lg:px-8">
          <p className="font-mono text-xs uppercase tracking-widest text-signal-500">
            {t.kicker}
          </p>
          <h1 className="mt-4 font-display text-4xl font-medium tracking-tight text-balance sm:text-5xl">
            {t.heading}
          </h1>
          <p className="mt-5 max-w-[58ch] text-lg leading-relaxed text-neutral-400">
            {t.sub}
          </p>
        </header>

        <Pricing locale={locale} />

        <section className="mx-auto max-w-7xl px-6 pb-24 lg:px-8">
          <div className="mx-auto max-w-3xl text-center">
            <h2 className="font-display text-3xl font-medium tracking-tight">
              {t.compareHeading}
            </h2>
            <p className="mx-auto mt-3 max-w-[52ch] text-base leading-relaxed text-neutral-400">
              {t.compareSub}
            </p>
          </div>

          <div className="mt-10 overflow-x-auto rounded-2xl border border-border bg-surface">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-raised">
                  <th className="px-4 py-3 text-left font-mono text-[0.65rem] uppercase tracking-widest text-neutral-400">
                    {t.featureColumn}
                  </th>
                  {TIERS.map((tier) => (
                    <th
                      key={tier.id}
                      className="px-4 py-3 text-center font-display text-sm font-medium tracking-tight text-foreground"
                    >
                      {tier.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {allFeatures.map((feature) => (
                  <tr key={feature} className="border-b border-border last:border-b-0">
                    <td className="px-4 py-3 text-left text-foreground">{feature}</td>
                    {TIERS.map((tier) => {
                      const has = tierFeatures(tier, locale).includes(feature);
                      return (
                        <td key={tier.id} className="px-4 py-3 text-center">
                          {has ? (
                            <Check className="mx-auto h-4 w-4 text-signal-500" aria-label="included" />
                          ) : (
                            <span className="text-neutral-500" aria-label="not included">—</span>
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
      </main>
      <Footer locale={locale} />
    </>
  );
}
