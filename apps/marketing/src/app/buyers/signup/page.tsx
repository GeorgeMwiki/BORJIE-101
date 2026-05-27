import type { Metadata } from 'next';
import Link from 'next/link';
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
 * Server component that resolves the locale, then mounts the
 * `BuyerSignupWizard` client component. The wizard POSTs to
 * `${NEXT_PUBLIC_API_GATEWAY_URL}/api/v1/buyers/signup` (or a
 * same-origin proxy in prod) and on 201 redirects to
 * `/buyers/sign-in?from=signup` so the buyer can authenticate.
 *
 * Mirrors the layout of the buyer marketing landing (same Nav,
 * Footer, hero kicker, hero heading) so the surface feels
 * continuous from the CTA.
 */
export default async function BuyersSignupPage() {
  const locale = await getLocale();
  const t = getMessages(locale).buyerSignupPage;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Nav locale={locale} />
      <main className="mx-auto max-w-3xl px-6 py-20">
        <header className="mb-10 max-w-2xl">
          <p className="mb-3 font-mono text-meta uppercase tracking-widest text-accent">
            {t.kicker}
          </p>
          <h1 className="font-display text-4xl font-bold tracking-tight md:text-5xl">
            {t.heading}
          </h1>
          <p className="mt-5 text-base text-foreground/70">{t.sub}</p>
        </header>

        <BuyerSignupWizard locale={locale} />

        <p className="mt-6 text-sm text-foreground/60">
          {t.alreadyHaveAccount}{' '}
          <Link
            href="/buyers/sign-in"
            className="font-medium text-signal-500 underline-offset-4 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 rounded-sm"
          >
            {t.signInLink}
          </Link>
        </p>
      </main>
      <Footer locale={locale} />
    </div>
  );
}
