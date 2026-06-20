import { Suspense } from 'react';
import type { Metadata } from 'next';
import { SignInForm } from './sign-in-form';
import { getServerT } from '@/i18n/t.server';
import { readLocaleFromServerCookies } from '@/lib/locale.server';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT();
  return { title: `${t('auth.signIn.submit')} — Borjie Owner Cockpit` };
}

/**
 * Owner cockpit sign-in landing. LitFin-pattern: full-screen centered
 * single-column card with subtle aurora + grid backdrop. The form
 * component owns its own visual rhythm (wordmark, heading, fields).
 */
export default async function SignInPage() {
  const t = await getServerT();
  // Seed the client form's locale from the SAME cookie the server resolved;
  // otherwise useLocale defaults to EN and renders a one-frame EN body under
  // the SW chrome (first-paint split-brain — zero-mix canon violation).
  const initialLocale = await readLocaleFromServerCookies();
  return (
    <main
      className="relative min-h-screen overflow-hidden bg-background p-6"
      id="main-content"
    >
      <div
        className="pointer-events-none absolute inset-0"
        aria-hidden="true"
        style={{
          background:
            'radial-gradient(ellipse 70% 50% at 50% 10%, hsl(var(--signal-500) / 0.12) 0%, transparent 60%)',
        }}
      />
      <div className="relative flex min-h-shell items-center justify-center">
        <Suspense
          fallback={
            <div className="text-sm text-neutral-500">
              {t('common.loading')}
            </div>
          }
        >
          <SignInForm initialLocale={initialLocale} />
        </Suspense>
      </div>
    </main>
  );
}
