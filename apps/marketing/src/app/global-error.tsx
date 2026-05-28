'use client';

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
 * because we cannot assume the stylesheet loaded. Tone still maps to
 * the LitFin DNA (navy canvas, gold accent, hairline border).
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
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif",
          background: '#0B0F19',
          color: '#F5F5F0',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
        }}
      >
        <div style={{ maxWidth: '440px', textAlign: 'center' }}>
          <div
            style={{
              width: '64px',
              height: '64px',
              borderRadius: '16px',
              background: 'rgba(225, 75, 75, 0.10)',
              border: '1px solid rgba(225, 75, 75, 0.30)',
              color: '#E14B4B',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '28px',
              marginBottom: '24px',
            }}
            aria-hidden="true"
          >
            !
          </div>
          <p
            style={{
              fontSize: '11px',
              letterSpacing: '0.22em',
              textTransform: 'uppercase',
              color: '#E14B4B',
              margin: 0,
              fontFamily: "'JetBrains Mono', ui-monospace, monospace",
            }}
          >
            Critical error
          </p>
          <h1
            style={{
              fontSize: '36px',
              fontWeight: 500,
              letterSpacing: '-0.02em',
              margin: '16px 0 12px',
            }}
          >
            We couldn't load this page.
          </h1>
          <p
            style={{
              fontSize: '14px',
              lineHeight: 1.6,
              color: '#A0A4B0',
              margin: '0 0 32px',
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
              gap: '8px',
              padding: '10px 20px',
              borderRadius: '12px',
              background: '#FFC857',
              color: '#0B0F19',
              fontSize: '14px',
              fontWeight: 600,
              border: 'none',
              boxShadow: '0 4px 12px -2px rgba(0,0,0,0.45)',
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
