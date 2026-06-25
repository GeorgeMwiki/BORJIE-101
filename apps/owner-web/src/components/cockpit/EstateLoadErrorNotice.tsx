'use client';

import { AlertTriangle, RefreshCw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { Button } from '@borjie/design-system';

import { useLocale, pickByLocale, type Locale } from '@/lib/locale';
import { cockpitClusterStrings as S } from '@/i18n/strings/cockpit-cluster';

interface EstateLoadErrorNoticeProps {
  /**
   * Server-resolved active locale, threaded from the page so the first
   * client render matches the SSR `<html lang>` language (no EN-under-SW
   * split-brain frame on this failure affordance). `undefined` falls back
   * to the document-resolved locale inside `useLocale`.
   */
  readonly initialLocale?: Locale | undefined;
}

/**
 * FAILURE-not-EMPTINESS affordance for the owner's estate / sites read.
 *
 * Rendered IN PLACE OF the session-derived sites count when
 * `OwnerSession.estateLoadError` is true — i.e. the gateway sites/estate
 * read FAILED. It never paints a fake-empty "0 sites"; instead it tells the
 * owner the count could not be loaded and offers a one-tap retry that
 * re-runs the server render (re-issuing the gateway read) via
 * `router.refresh()`.
 *
 * A genuinely EMPTY estate (estateLoadError false + zero sites) keeps its
 * own empty-state copy at the call site — the two states stay distinct.
 */
export function EstateLoadErrorNotice({
  initialLocale,
}: EstateLoadErrorNoticeProps): JSX.Element {
  const locale = useLocale(initialLocale);
  const router = useRouter();
  const [isRetrying, startRetry] = useTransition();

  return (
    <div
      role="status"
      data-testid="estate-load-error"
      className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-warning/40 bg-warning/5 px-4 py-3"
    >
      <AlertTriangle className="h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">
          {pickByLocale(locale, S.estate.loadFailed)}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {pickByLocale(locale, S.estate.loadFailedHint)}
        </p>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => startRetry(() => router.refresh())}
        loading={isRetrying}
        leftIcon={<RefreshCw className="h-3.5 w-3.5" />}
        className="shrink-0 gap-1.5"
      >
        {pickByLocale(locale, S.estate.retry)}
      </Button>
    </div>
  );
}
