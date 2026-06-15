'use client';

/* eslint-disable borjie/no-non-token-style -- This boundary renders before
   the app stylesheet loads (root layout itself threw), so design-system
   tokens are unavailable and the colour tokens hold HSL triplets, not ready
   values. Literal brand hex is the ONE correct place here — see the header
   note below. Layer-3 brand enforcement is intentionally suspended for this
   single self-contained crash surface. */

/**
 * Marketing site root-level error boundary.
 *
 * Next.js renders `global-error.tsx` only when the root `layout.tsx`
 * itself throws (i.e. before fonts, css, or our normal `error.tsx`
 * boundary mount). It therefore MUST include its own `<html>` /
 * `<body>` and cannot rely on any provider, theme or font from the
 * layout above it.
 *
 * Visual is intentionally minimal — inline styles only, no Tailwind —
 * because we cannot assume the stylesheet loaded. The fallback colours
 * are literal brand hex (the ONE place literals are correct: the
 * stylesheet that defines the tokens may not have loaded), tuned to the
 * copper-on-warm-charcoal IGNITION palette so a root crash still reads
 * on-brand. Colour tokens hold HSL *triplets* (e.g. `24 68% 58%`), not
 * ready colours, so they cannot be used raw as a `background` value —
 * the literal hex carries this surface.
 */
import { useEffect } from 'react';

interface GlobalErrorProps {
  readonly error: Error & { readonly digest?: string };
  readonly reset: () => void;
}

export default function GlobalError({ error, reset }: GlobalErrorProps) {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') {
      // eslint-disable-next-line no-console -- dev-only diagnostic
      console.error('[marketing/global-error]', error);
    }
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          fontFamily:
            "var(--font-sans, -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif)",
          background: '#141210',
          color: '#F5F1EC',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 'var(--space-eb-pad, 24px)',
        }}
      >
        <div style={{ maxWidth: 'var(--space-eb-card-max, 440px)', textAlign: 'center' }}>
          <div
            style={{
              width: 'var(--space-eb-icon, 64px)',
              height: 'var(--space-eb-icon, 64px)',
              borderRadius: 'var(--radius-eb-icon, 16px)',
              background: 'rgba(205, 83, 64, 0.12)',
              border: '1px solid rgba(205, 83, 64, 0.30)',
              color: '#CD5340',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 'var(--space-eb-icon-glyph, 28px)',
              marginBottom: 'var(--space-eb-icon-mb, 24px)',
            }}
            aria-hidden="true"
          >
            !
          </div>
          <p
            style={{
              fontSize: 'var(--space-eb-eyebrow, 11px)',
              letterSpacing: 'var(--space-eb-tracking, 0.22em)',
              textTransform: 'uppercase',
              color: '#CD5340',
              margin: 0,
              fontFamily: "var(--font-mono, 'JetBrains Mono', ui-monospace, monospace)",
            }}
          >
            Critical error
          </p>
          <h1
            style={{
              fontSize: 'var(--space-eb-h1, 36px)',
              fontWeight: 600,
              letterSpacing: 'var(--space-eb-h1-tracking, -0.02em)',
              margin: 'var(--space-eb-h1-margin, 16px 0 12px)',
            }}
          >
            We couldn't load this page.
          </h1>
          <p
            style={{
              fontSize: 'var(--space-eb-body, 14px)',
              lineHeight: 'var(--lh-eb, 1.6)',
              color: '#B4ADA4',
              margin: 'var(--space-eb-body-margin, 0 0 32px)',
            }}
          >
            Something failed before we could render anything. Try
            reloading. If it keeps happening, our team has been
            notified.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 'var(--space-eb-btn-gap, 8px)',
              padding: 'var(--space-eb-btn-pad, 10px 20px)',
              borderRadius: 'var(--radius-eb-btn, 12px)',
              background: '#D9824E',
              color: '#141210',
              fontSize: 'var(--space-eb-body, 14px)',
              fontWeight: 600,
              border: 'none',
              boxShadow: 'var(--shadow-eb-btn, 0 4px 12px -2px rgba(0,0,0,0.45))',
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
