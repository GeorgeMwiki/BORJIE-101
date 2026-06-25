'use client';

/**
 * Admin (HQ) console global error boundary.
 * Centred-card pattern. Suppresses digest in production.
 *
 * SINGLE LANGUAGE PER LOCALE (canon): every user-facing string resolves to
 * the active locale via `pickByLocale`. As a Next error boundary this surface
 * cannot be seeded with a server-resolved `initialLocale`, so the unseeded
 * `useLocale()` hook self-corrects on mount from the cookie — never a
 * mid-string EN/SW mix. Mirrors `app/internal/error.tsx`.
 */
import { useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, RefreshCw, TriangleAlert } from 'lucide-react';
import { useLocale, pickByLocale } from '@/lib/locale';

const STRINGS = {
  eyebrow: { en: 'Something went wrong', sw: 'Kuna hitilafu imetokea' },
  title: { en: "That didn't load.", sw: 'Hiyo haikupakia.' },
  body: {
    en: "We've captured the error. Try again. If it keeps happening, escalate via the HQ incident channel.",
    sw: 'Tumenasa hitilafu. Jaribu tena. Ikiendelea kutokea, ipeleke kupitia njia ya matukio ya makao makuu.',
  },
  retry: { en: 'Try again', sw: 'Jaribu tena' },
  back: { en: 'Back to console', sw: 'Rudi kwenye konsoli' },
  ref: { en: 'ref', sw: 'kumb' },
} as const;

interface ErrorPageProps {
  readonly error: Error & { readonly digest?: string };
  readonly reset: () => void;
}

export default function AdminError({ error, reset }: ErrorPageProps) {
  const locale = useLocale();

  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') {
      // eslint-disable-next-line no-console -- dev-only diagnostic
      console.error('[admin-web/error]', error);
    }
  }, [error]);

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
            'radial-gradient(ellipse 70% 50% at 50% 10%, hsl(var(--destructive) / 0.10) 0%, transparent 60%)',
        }}
      />
      <div className="relative w-full max-w-md text-center">
        <div className="mx-auto mb-6 inline-flex h-16 w-16 items-center justify-center rounded-2xl border border-destructive/30 bg-destructive/10 text-destructive shadow-sm">
          <TriangleAlert aria-hidden="true" className="h-7 w-7" />
        </div>
        <p className="font-mono text-mini uppercase tracking-eyebrow-wide text-destructive">
          {pickByLocale(locale, STRINGS.eyebrow)}
        </p>
        <h1 className="mt-4 font-display text-4xl font-medium tracking-tight text-foreground sm:text-5xl">
          {pickByLocale(locale, STRINGS.title)}
        </h1>
        <p className="mx-auto mt-4 max-w-sm text-sm leading-relaxed text-muted-foreground">
          {pickByLocale(locale, STRINGS.body)}
        </p>
        {error.digest && process.env.NODE_ENV !== 'production' ? (
          <p className="mt-3 font-mono text-tiny uppercase tracking-widest text-muted-foreground/70">
            {pickByLocale(locale, STRINGS.ref)}: {error.digest}
          </p>
        ) : null}
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={reset}
            className="inline-flex items-center gap-2 rounded-xl bg-signal-500 px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-md transition-all hover:bg-signal-400 hover:shadow-lg active:scale-[0.99] focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <RefreshCw aria-hidden="true" className="h-4 w-4" />
            {pickByLocale(locale, STRINGS.retry)}
          </button>
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-5 py-2.5 text-sm font-medium text-foreground transition-colors hover:border-border-strong hover:bg-muted/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <ArrowLeft aria-hidden="true" className="h-4 w-4" />
            {pickByLocale(locale, STRINGS.back)}
          </Link>
        </div>
      </div>
    </main>
  );
}
