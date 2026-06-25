'use client';

/**
 * Segment error boundary for the `internal/` admin console group.
 *
 * Next renders this when any internal screen throws during render. It is
 * scoped tighter than the root `app/error.tsx` so an operator stays
 * inside the console chrome and can retry a single screen without a full
 * reload. Built on the design-system `Alert` (error variant) + DS
 * `Button` so it inherits the canonical danger tokens.
 *
 * SINGLE LANGUAGE PER LOCALE (canon): every user-facing string resolves
 * to the active locale via `pickByLocale`. As a Next error boundary this
 * surface cannot be seeded with a server-resolved `initialLocale`, so the
 * unseeded `useLocale()` hook self-corrects on mount from the cookie —
 * never a mid-string EN/SW mix.
 */
import { useEffect } from 'react';
import { Alert, Button } from '@borjie/design-system';
import { RefreshCw } from 'lucide-react';
import { useLocale, pickByLocale } from '@/lib/locale';

const STRINGS = {
  eyebrow: { en: 'Console error', sw: 'Hitilafu ya konsoli' },
  title: { en: 'This screen failed to load.', sw: 'Skrini hii imeshindwa kupakia.' },
  body: {
    en: 'The error has been captured. Retry this screen. If it persists, escalate via the HQ incident channel.',
    sw: 'Hitilafu imenaswa. Jaribu tena skrini hii. Ikiendelea, ipeleke kupitia njia ya matukio ya makao makuu.',
  },
  retry: { en: 'Try again', sw: 'Jaribu tena' },
  ref: { en: 'ref', sw: 'kumb' },
} as const;

interface ErrorPageProps {
  readonly error: Error & { readonly digest?: string };
  readonly reset: () => void;
}

export default function InternalError({ error, reset }: ErrorPageProps): JSX.Element {
  const locale = useLocale();

  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') {
      // eslint-disable-next-line no-console -- dev-only diagnostic
      console.error('[admin-web/internal/error]', error);
    }
  }, [error]);

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <Alert
        variant="error"
        title={pickByLocale(locale, STRINGS.title)}
        actions={
          <Button type="button" variant="outline" size="sm" onClick={reset} leftIcon={<RefreshCw className="h-4 w-4" />}>
            {pickByLocale(locale, STRINGS.retry)}
          </Button>
        }
      >
        <p className="font-mono text-mini uppercase tracking-eyebrow-wide text-danger">
          {pickByLocale(locale, STRINGS.eyebrow)}
        </p>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {pickByLocale(locale, STRINGS.body)}
        </p>
        {error.digest && process.env.NODE_ENV !== 'production' ? (
          <p className="mt-3 font-mono text-tiny uppercase tracking-widest text-muted-foreground/70">
            {pickByLocale(locale, STRINGS.ref)}: {error.digest}
          </p>
        ) : null}
      </Alert>
    </div>
  );
}
