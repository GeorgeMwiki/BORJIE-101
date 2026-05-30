import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { ShieldCheck } from 'lucide-react';

import { OwnerSignInForm } from '@/components/auth/OwnerSignInForm';
import { getLocale } from '@/lib/locale';
import { getMessages } from '@/lib/i18n';

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const t = getMessages(locale).ownerSignInPage;
  return {
    title: t.metaTitle,
    description: t.metaDescription,
  };
}

// `useSearchParams` in the form forces this page to be dynamic.
export const dynamic = 'force-dynamic';

/**
 * /sign-in — Owner sign-in landing.
 *
 * LitFin-pattern single-column card on the navy + gold cinematic frame.
 * The form posts to `/api/v1/auth/sign-in` with credentials included,
 * then hard-redirects to the owner cockpit on success. The marketing
 * site never touches Supabase directly — the gateway is the only auth
 * surface, and the borjie-session cookie is the only browser state.
 */
export default async function SignInPage() {
  const locale = await getLocale();
  const t = getMessages(locale).ownerSignInPage;

  return (
    <>
      
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
            <p className="mx-auto mt-5 max-w-prose-wider text-base leading-relaxed text-foreground/70">
              {t.sub}
            </p>
          </header>

          <Suspense
            fallback={
              <div
                data-testid="owner-signin-loading"
                className="rounded-2xl border border-border bg-surface/40 p-6 text-sm text-foreground/60"
              >
                {'...'}
              </div>
            }
          >
            <OwnerSignInForm locale={locale} />
          </Suspense>

          <p className="mt-6 text-center text-sm text-foreground/70">
            {t.noAccountYet}{' '}
            <Link
              href="/sign-up"
              className="font-medium text-signal-500 underline-offset-4 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 rounded-sm"
            >
              {t.signUpLink}
            </Link>
          </p>

          <p className="mt-8 inline-flex w-full items-center justify-center gap-1.5 font-mono text-caption uppercase tracking-widest text-foreground/60">
            <ShieldCheck className="h-3 w-3 text-signal-500" />
            {locale === 'sw'
              ? `BRELA · TRA · ${'Tum' + 'emadini'} verified`
              : 'BRELA · TRA · Mining Commission verified'}
          </p>
        </div>
      </main>
      
    </>
  );
}
