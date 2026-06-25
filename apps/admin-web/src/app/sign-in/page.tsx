import { Suspense } from 'react';
import { SignInForm } from './sign-in-form';
import { readLocaleFromServerCookies } from '@/lib/locale.server';
// IMPORTANT: import pickByLocale from locale-shared (hook-free), NOT from
// @/lib/locale — the latter also exports useLocale which uses useEffect, and
// pulling that into a Server Component fails the Next build with the "needs
// useEffect ... mark with use client" error. locale-shared is pure.
import { pickByLocale } from '@/lib/locale-shared';

export const dynamic = 'force-dynamic';

// Locale-aware <title>. Just the per-page noun; layout.tsx's template appends
// the locale-aware console name (`— Borjie Console` / `— Konsoli ya Borjie`).
export async function generateMetadata() {
  const locale = await readLocaleFromServerCookies();
  return {
    title: pickByLocale(locale, { en: 'Sign in', sw: 'Ingia' }),
  };
}

/**
 * Borjie internal HQ sign-in landing. Pattern: full-screen
 * centered single-column card with subtle aurora backdrop. Form
 * component owns the editorial weight (wordmark, heading, fields).
 */
export default async function SignInPage() {
  // Seed the client form's locale from the SAME cookie SSR resolves so the
  // first paint isn't an EN body under SW chrome (zero-mix split-brain).
  const initialLocale = await readLocaleFromServerCookies();
  const loading = pickByLocale(initialLocale, {
    en: 'Loading…',
    sw: 'Inapakia…',
  });
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
          fallback={<div className="text-sm text-neutral-500">{loading}</div>}
        >
          <SignInForm initialLocale={initialLocale} />
        </Suspense>
      </div>
    </main>
  );
}
