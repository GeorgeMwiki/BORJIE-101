'use client';

/**
 * Admin (HQ) console root-level error boundary.
 *
 * Next.js renders `global-error.tsx` only when the root `layout.tsx`
 * itself throws (i.e. before fonts, css, or the segment `error.tsx`
 * boundary mounts). It therefore MUST carry its own `<html>` / `<body>`
 * and cannot rely on any provider, theme, or font from the layout above
 * it — nor on the Tailwind stylesheet, which may not have loaded.
 *
 * Visual is intentionally minimal — inline styles only, each reading a
 * CSS var with a hard-coded fallback so the surface still looks like the
 * console even when the theme sheet is absent. English-only — the admin
 * console is staff-facing.
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
      console.error('[admin-web/global-error]', error);
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
          background: 'var(--background, #0B0F19)',
          color: 'var(--foreground, #F5F5F0)',
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
              background: 'var(--destructive-soft, rgba(225, 75, 75, 0.10))',
              border: '1px solid var(--destructive-strong, rgba(225, 75, 75, 0.30))',
              color: 'var(--destructive, #E14B4B)',
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
              color: 'var(--destructive, #E14B4B)',
              margin: 0,
              fontFamily: "var(--font-mono, 'JetBrains Mono', ui-monospace, monospace)",
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
            The console couldn't load.
          </h1>
          <p
            style={{
              fontSize: '14px',
              lineHeight: 1.6,
              color: 'var(--muted-foreground, #A0A4B0)',
              margin: '0 0 32px',
            }}
          >
            Something failed before the HQ console could render. Try
            reloading — if it keeps happening, escalate via the incident
            channel.
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
              background: 'var(--signal-500, #FFC857)',
              color: 'var(--background, #0B0F19)',
              fontSize: '14px',
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
