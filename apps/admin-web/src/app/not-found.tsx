import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft, Compass } from 'lucide-react';
import { pickByLocale } from '@/lib/locale-shared';
import { readLocaleFromServerCookies } from '@/lib/locale.server';

export const metadata: Metadata = {
  title: 'Page not found — Borjie HQ',
  description: 'The console page you requested could not be found.',
  robots: { index: false, follow: false },
};

const STRINGS = {
  eyebrow: {
    en: '404 · Page not found',
    sw: '404 · Ukurasa haukupatikana',
  },
  title: {
    en: "We can't find that page.",
    sw: 'Hatupati ukurasa huo.',
  },
  body: {
    en: 'The link may be old, mistyped, or the page has moved. Head back to the console home or open a recent issue.',
    sw: 'Kiungo huenda ni cha zamani, kimekosewa kuandikwa, au ukurasa umehamishwa. Rudi kwenye nyumbani ya konsoli au fungua suala la hivi karibuni.',
  },
  back: { en: 'Back to console', sw: 'Rudi kwenye konsoli' },
  viewAudit: { en: 'View audit', sw: 'Tazama ukaguzi' },
} as const;

/**
 * Admin (HQ) console not-found surface. Centred-card pattern on the navy
 * canvas with the gold aurora at the top.
 *
 * SINGLE LANGUAGE PER LOCALE (canon): the locale is resolved server-side
 * from the `borjie_locale` cookie and every string renders in that one
 * language — no EN copy under the SW-aware AdminShell. Mirrors the
 * localized `app/error.tsx` boundary.
 */
export default async function AdminNotFoundPage(): Promise<JSX.Element> {
  const locale = await readLocaleFromServerCookies();
  return (
    <main
      id="main-content"
      className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-6 py-12"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 70% 50% at 50% 10%, hsl(var(--signal-500) / 0.10) 0%, transparent 60%)',
        }}
      />
      <div className="relative w-full max-w-md text-center">
        <div className="mx-auto mb-6 inline-flex h-16 w-16 items-center justify-center rounded-2xl border border-border bg-card text-signal-500 shadow-sm">
          <Compass aria-hidden="true" className="h-7 w-7" />
        </div>
        <p className="font-mono text-mini uppercase tracking-eyebrow-wide text-signal-500">
          {pickByLocale(locale, STRINGS.eyebrow)}
        </p>
        <h1 className="mt-4 font-display text-4xl font-medium tracking-tight text-foreground sm:text-5xl">
          {pickByLocale(locale, STRINGS.title)}
        </h1>
        <p className="mx-auto mt-4 max-w-sm text-sm leading-relaxed text-muted-foreground">
          {pickByLocale(locale, STRINGS.body)}
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-xl bg-signal-500 px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-md transition-all hover:bg-signal-400 hover:shadow-lg active:scale-[0.99] focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <ArrowLeft aria-hidden="true" className="h-4 w-4" />
            {pickByLocale(locale, STRINGS.back)}
          </Link>
          <Link
            href="/audit"
            className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-5 py-2.5 text-sm font-medium text-foreground transition-colors hover:border-border-strong hover:bg-muted/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            {pickByLocale(locale, STRINGS.viewAudit)}
          </Link>
        </div>
      </div>
    </main>
  );
}
