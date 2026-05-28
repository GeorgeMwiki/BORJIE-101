'use client';

/**
 * Global error boundary for the marketing site.
 *
 * Renders when an unhandled exception escapes a server or client render.
 * LitFin-pattern: tinted icon container, display heading, muted sub,
 * primary "Try again" CTA + secondary "Back to home". Digest is shown
 * only in dev so support can correlate; in prod we suppress it (the
 * Sentry capture is already wired in `instrumentation.ts`).
 */
import { useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, RefreshCw, TriangleAlert } from 'lucide-react';

interface ErrorPageProps {
  readonly error: Error & { readonly digest?: string };
  readonly reset: () => void;
}

export default function MarketingError({ error, reset }: ErrorPageProps) {
  useEffect(() => {
    // Client-side error reporting hook. The Sentry instrumentation in
    // `instrumentation.ts` already captures via Next.js, this just
    // mirrors to the console so the digest is grep-able in dev.
    if (process.env.NODE_ENV !== 'production') {
      // eslint-disable-next-line no-console -- dev-only diagnostic
      console.error('[marketing/error]', error);
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
        <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-destructive">
          Something went wrong
        </p>
        <h1 className="mt-4 font-display text-4xl font-medium tracking-tight text-foreground sm:text-5xl">
          That didn't load.
        </h1>
        <p className="mx-auto mt-4 max-w-sm text-sm leading-relaxed text-muted-foreground">
          Kuna tatizo la muda. We've captured the error. Try again — if
          it keeps happening, our team is already looking.
        </p>
        {error.digest && process.env.NODE_ENV !== 'production' ? (
          <p className="mt-3 font-mono text-[10px] uppercase tracking-widest text-muted-foreground/70">
            ref: {error.digest}
          </p>
        ) : null}
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={reset}
            className="inline-flex items-center gap-2 rounded-xl bg-signal-500 px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-md transition-all hover:bg-signal-400 hover:shadow-lg active:scale-[0.99] focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <RefreshCw aria-hidden="true" className="h-4 w-4" />
            Try again
          </button>
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-5 py-2.5 text-sm font-medium text-foreground transition-colors hover:border-border-strong hover:bg-muted/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <ArrowLeft aria-hidden="true" className="h-4 w-4" />
            Back to home
          </Link>
        </div>
      </div>
    </main>
  );
}
