import type { Metadata } from 'next';
import Link from 'next/link';
import { ShieldCheck } from 'lucide-react';
import { Nav } from '@/components/Nav';
import { Footer } from '@/components/Footer';
import { BuyerSignupWizard } from '@/components/buyer/BuyerSignupWizard';
import { getLocale } from '@/lib/locale';
import { getMessages } from '@/lib/i18n';

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const t = getMessages(locale).buyerSignupPage;
  return {
    title: t.metaTitle,
    description: t.metaDescription,
  };
}

/**
 * /buyers/signup — public buyer self-signup landing.
 *
 * Single-column LitFin-pattern: small kicker, big declarative heading,
 * one-sentence sub, then the wizard in a generous card. Step pill is
 * provided by the BuyerSignupWizard itself (kept) — page only owns the
 * editorial frame plus trust microcopy below.
 */
export default async function BuyersSignupPage() {
  const locale = await getLocale();
  const t = getMessages(locale).buyerSignupPage;

  return (
    <>
      <Nav locale={locale} />
      <main
        id="main-content"
        className="relative min-h-screen overflow-hidden bg-background text-foreground"
      >
        <div className="hero-aurora" aria-hidden="true" />
        <div className="absolute inset-0 cinematic-grid opacity-20" aria-hidden="true" />
        <div className="relative mx-auto max-w-3xl px-6 py-20 lg:py-28">
          <header className="mb-10 text-center">
            <p className="font-mono text-caption uppercase tracking-widest text-signal-500">
              {t.kicker}
            </p>
            <h1 className="mt-4 font-display text-4xl font-medium tracking-tight text-balance sm:text-5xl">
              {t.heading}
            </h1>
            <p className="mx-auto mt-5 max-w-prose-wider text-base leading-relaxed text-neutral-400">
              {t.sub}
            </p>
          </header>

          <BuyerSignupWizard locale={locale} />

          <p className="mt-6 text-center text-sm text-neutral-400">
            {t.alreadyHaveAccount}{' '}
            <Link
              href="/buyers/sign-in"
              className="font-medium text-signal-500 underline-offset-4 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 rounded-sm"
            >
              {t.signInLink}
            </Link>
          </p>

          <p className="mt-8 inline-flex w-full items-center justify-center gap-1.5 font-mono text-caption uppercase tracking-widest text-neutral-500">
            <ShieldCheck className="h-3 w-3 text-signal-500" />
            KYB-verified · biometric off-take · audit chain
          </p>
        </div>
      </main>
      <Footer locale={locale} />
    </>
  );
}
