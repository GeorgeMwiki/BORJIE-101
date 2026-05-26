import type { Metadata } from 'next';
import Link from 'next/link';
import { Nav } from '@/components/Nav';
import { Footer } from '@/components/Footer';
import { getLocale } from '@/lib/locale';
import { getMessages } from '@/lib/i18n';

export const metadata: Metadata = {
  title: 'Borjie for buyers — verified Tanzanian minerals',
  description:
    'Borjie for mineral buyers and off-takers. KYB-verified sellers, chain-of-custody assays, biometric contract signing. Live marketplace from Geita, Mererani, Kahama, Mbeya.',
};

export default async function BuyersPage() {
  const locale = await getLocale();
  const t = getMessages(locale).buyersPage;
  const valueProps = t.valueProps.shortCards;
  const regions = t.regions;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Nav locale={locale} />
      <main className="mx-auto max-w-6xl px-6 py-20">
        <header className="mb-16 max-w-3xl">
          <p className="mb-4 text-sm uppercase tracking-widest text-accent">
            {t.kicker}
          </p>
          <h1 className="font-display text-5xl font-bold tracking-tight md:text-6xl">
            {t.heading}
          </h1>
          <p className="mt-6 text-xl text-foreground/70">
            {t.sub}
          </p>
          <div className="mt-10 flex flex-wrap gap-4">
            <Link
              href="/pilot?role=buyer"
              className="rounded-md bg-primary px-6 py-3 font-semibold text-background hover:bg-accent"
            >
              {t.ctaSignUpBuy}
            </Link>
            <Link
              href="/pricing"
              className="rounded-md border border-border px-6 py-3 font-semibold hover:bg-surface"
            >
              {t.ctaPricingFees}
            </Link>
          </div>
        </header>

        <section className="grid grid-cols-1 gap-6 md:grid-cols-2">
          {valueProps.map((v) => (
            <div key={v.title} className="rounded-lg border border-border bg-surface/40 p-6">
              <h2 className="mb-2 font-display text-xl font-semibold">{v.title}</h2>
              <p className="text-foreground/70">{v.body}</p>
            </div>
          ))}
        </section>

        <section className="mt-20">
          <h2 className="mb-6 font-display text-3xl font-bold">
            {t.regionsHeading}
          </h2>
          <ul className="grid grid-cols-2 gap-3 text-sm md:grid-cols-3">
            {regions.map((r) => (
              <li key={r} className="rounded-md border border-border bg-background px-4 py-2">
                {r}
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-20 rounded-lg border border-accent/40 bg-surface/30 p-8 text-center">
          <p className="text-sm uppercase tracking-widest text-accent">
            {t.marketplaceFeeKicker}
          </p>
          <p className="mt-4 font-display text-4xl font-bold">2.5%</p>
          <p className="mt-2 text-foreground/70">
            {t.marketplaceFeeBody}
          </p>
        </section>
      </main>
      <Footer locale={locale} />
    </div>
  );
}
