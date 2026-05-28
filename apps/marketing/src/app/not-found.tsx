import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft, Compass } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Page not found — Borjie',
  description: 'The page you requested could not be found.',
  robots: { index: false, follow: false },
};

/**
 * /404 — LitFin-pattern not-found surface for the marketing site.
 *
 * Centered single column on a soft aurora canvas. Tinted icon container,
 * display heading, bilingual sub, and one primary CTA back to home plus
 * a secondary CTA to sign up.
 *
 * Intentionally minimal — no marketing chrome (Nav/Footer) so the
 * surface reads as a system page, not a navigation dead end.
 */
export default function NotFoundPage() {
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
        <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-signal-500">
          404 · Page not found
        </p>
        <h1 className="mt-4 font-display text-4xl font-medium tracking-tight text-foreground sm:text-5xl">
          We can't find that page.
        </h1>
        <p className="mx-auto mt-4 max-w-sm text-sm leading-relaxed text-muted-foreground">
          Ukurasa hauonekani. The link may be old, mistyped, or the
          page has moved. Try one of these instead.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-xl bg-signal-500 px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-md transition-all hover:bg-signal-400 hover:shadow-lg active:scale-[0.99] focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <ArrowLeft aria-hidden="true" className="h-4 w-4" />
            Back to home
          </Link>
          <Link
            href="/signup"
            className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-5 py-2.5 text-sm font-medium text-foreground transition-colors hover:border-border-strong hover:bg-muted/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            Get started
          </Link>
        </div>
      </div>
    </main>
  );
}
