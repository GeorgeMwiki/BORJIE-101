'use client';

/**
 * `(routes)` GROUP error boundary (Next.js convention).
 *
 * This is the TIGHTER, shell-preserving boundary that sits below the
 * root layout's cockpit chrome / navigation. When a routed segment
 * throws, the root `app/error.tsx` would take over the WHOLE viewport;
 * this group boundary instead keeps the nav mounted and replaces only
 * the routed content area with a DS `Alert` + a retry CTA, so the owner
 * stays oriented and can recover in place.
 *
 * Built on the DS error pattern: `Alert` (variant="error") carries the
 * message; DS `Button`s drive `reset()` (re-render the segment) and a
 * link home. The digest is shown only in non-production.
 *
 * LOCALE-PURE: the active language is read from the `borjie_locale`
 * cookie via `useLocale()` and a SINGLE language is rendered through
 * `pickByLocale` — never a concatenated EN/SW string (hard rule). All
 * copy lives in the guard-exempt `routes-group-error` string module.
 */
import { useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { Alert, Button } from '@borjie/design-system';
import { useLocale, pickByLocale } from '@/lib/locale';
import { routesGroupErrorStrings as S } from '@/i18n/strings/routes-group-error';

interface RoutesErrorProps {
  readonly error: Error & { readonly digest?: string };
  readonly reset: () => void;
}

export default function RoutesGroupError({ error, reset }: RoutesErrorProps) {
  const locale = useLocale();

  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') {
      // eslint-disable-next-line no-console -- dev-only diagnostic
      console.error('[owner-web/(routes)/error]', error);
    }
  }, [error]);

  return (
    <div id="main-content" className="px-8 py-8">
      <Alert
        variant="error"
        title={pickByLocale(locale, S.title)}
        actions={
          <>
            <Button onClick={reset} variant="primary" size="sm">
              <RefreshCw aria-hidden="true" className="h-4 w-4" />
              {pickByLocale(locale, S.retry)}
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/">
                <ArrowLeft aria-hidden="true" className="h-4 w-4" />
                {pickByLocale(locale, S.backToCockpit)}
              </Link>
            </Button>
          </>
        }
      >
        <p>{pickByLocale(locale, S.body)}</p>
        {error.digest && process.env.NODE_ENV !== 'production' ? (
          <p className="mt-2 font-mono text-tiny uppercase tracking-widest text-muted-foreground/70">
            ref: {error.digest}
          </p>
        ) : null}
      </Alert>
    </div>
  );
}
