import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
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
 * Server component that resolves the locale, then mounts the
 * `BuyerSignInForm` client component inside a Suspense boundary
 * (required by Next 15 because the form reads `useSearchParams`
 * to detect `?from=signup`).
 *
 * On successful sign-in the form does a cross-origin redirect to
 * `${NEXT_PUBLIC_OWNER_WEB_URL}/dashboard?as=buyer` (defaults to
 * `http://localhost:3010` in dev). Borjie uses a unified cockpit
 * for buyers — the persona-runtime gates the surface to
 * buyer-relevant cards.
 */
export default async function BuyersSignInPage() {
  const locale = await getLocale();
  const t = getMessages(locale).buyerSignInPage;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Nav locale={locale} />
      <main className="mx-auto max-w-xl px-6 py-20">
        <header className="mb-10">
          <p className="mb-3 font-mono text-meta uppercase tracking-widest text-accent">
            {t.kicker}
          </p>
          <h1 className="font-display text-4xl font-bold tracking-tight md:text-5xl">
            {t.heading}
          </h1>
          <p className="mt-5 text-base text-foreground/70">{t.sub}</p>
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

        <p className="mt-6 text-sm text-foreground/60">
          {t.noAccountYet}{' '}
          <Link
            href="/buyers/signup"
            className="font-medium text-signal-500 underline-offset-4 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 rounded-sm"
          >
            {t.signUpLink}
          </Link>
        </p>
      </main>
      <Footer locale={locale} />
    </div>
  );
}
