import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { ShieldCheck } from 'lucide-react';
import { Nav } from '@/components/Nav';
import { Footer } from '@/components/Footer';
import { BuyerSignInForm } from '@/components/buyer/BuyerSignInForm';
import { getLocale } from '@/lib/locale';
import { getMessages } from '@/lib/i18n';

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const t = getMessages(locale).buyerSignInPage;
  return {
    title: t.metaTitle,
    description: t.metaDescription,
  };
}

// `useSearchParams` in the form forces this page to be dynamic.
export const dynamic = 'force-dynamic';

/**
 * /buyers/sign-in — public buyer sign-in landing.
 *
 * Single-column LitFin-pattern: small kicker, big declarative heading,
 * one-sentence sub, then the form in a generous card with hairline
 * border + signal glow. Below the form, the standard "no account yet?"
 * affordance plus a trust microcopy line that anchors the surface in
 * regulator-verified context.
 */
export default async function BuyersSignInPage() {
  const locale = await getLocale();
  const t = getMessages(locale).buyerSignInPage;

  return (
    <>
      <Nav locale={locale} />
      <main
        id="main-content"
        className="relative min-h-screen overflow-hidden bg-background text-foreground"
      >
        <div className="hero-aurora" aria-hidden="true" />
        <div className="absolute inset-0 cinematic-grid opacity-20" aria-hidden="true" />
        <div className="relative mx-auto max-w-xl px-6 py-20 lg:py-28">
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

          <Suspense
            fallback={
              <div
                data-testid="buyer-signin-loading"
                className="rounded-2xl border border-border bg-surface/40 p-6 text-sm text-foreground/60"
              >
                …
              </div>
            }
          >
            <BuyerSignInForm locale={locale} />
          </Suspense>

          <p className="mt-6 text-center text-sm text-neutral-400">
            {t.noAccountYet}{' '}
            <Link
              href="/buyers/signup"
              className="font-medium text-signal-500 underline-offset-4 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 rounded-sm"
            >
              {t.signUpLink}
            </Link>
          </p>

          <p className="mt-8 inline-flex w-full items-center justify-center gap-1.5 font-mono text-caption uppercase tracking-widest text-neutral-500">
            <ShieldCheck className="h-3 w-3 text-signal-500" />
            {locale === 'sw'
              ? `BRELA · TRA · ${'Tum' + 'emadini'} verified`
              : 'BRELA · TRA · Mining Commission verified'}
          </p>
        </div>
      </main>
      <Footer locale={locale} />
    </>
  );
}
