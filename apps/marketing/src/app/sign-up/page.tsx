import type { Metadata } from 'next';
import Link from 'next/link';
import { ShieldCheck } from 'lucide-react';

import { OwnerSignUpForm } from '@/components/auth/OwnerSignUpForm';
import { getLocale } from '@/lib/locale';
import { getMessages } from '@/lib/i18n';

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const t = getMessages(locale).ownerSignUpPage;
  return {
    title: t.metaTitle,
    description: t.metaDescription,
  };
}

export const dynamic = 'force-dynamic';

/**
 * /sign-up — Owner self-signup landing on the public marketing surface.
 *
 * Posts to `/api/v1/orgs/signup` via the marketing-form contract; the
 * gateway creates the Supabase user + tenant + persona binding + audit
 * entry inside one flow, then mints a Supabase session and sets the
 * encrypted `borjie-session` HttpOnly cookie before answering 201. On
 * success we hard-redirect the visitor to the cockpit (different
 * origin in dev) which rehydrates from the cookie on first load.
 */
export default async function SignUpPage() {
  const locale = await getLocale();
  const t = getMessages(locale).ownerSignUpPage;

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

          <OwnerSignUpForm locale={locale} />

          <p className="mt-6 text-center text-sm text-foreground/70">
            {t.haveAccount}{' '}
            <Link
              href="/sign-in"
              className="font-medium text-signal-500 underline-offset-4 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 rounded-sm"
            >
              {t.signInLink}
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
