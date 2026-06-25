'use client';

/**
 * Detail panel for the per-person memory cells page.
 *
 * GET /api/v1/me/persons/:personId/cells returns:
 *   - 200 { success, data: MemoryCell[] }
 *   - 403 { success: false, error: { code: 'CONSENT_REQUIRED' | 'FORBIDDEN_PERSON' } }
 *   - 503 { success: false, error: { code: 'DATABASE_UNAVAILABLE' } }
 *
 * The 403 CONSENT_REQUIRED branch shows a bilingual banner directing
 * the user to the Settings → Share consent screen instead of the
 * memory-cell list. The 403 FORBIDDEN_PERSON branch shows a security
 * notice.
 */

import { useCallback, useEffect, useState } from 'react';
import { Skeleton, Alert } from '@borjie/design-system';
import { apiRequest, ApiError, localizeError } from '@/lib/api-client';
import { routesAStrings as S } from '@/i18n/strings/routes-a';
import { personalKbClusterStrings as P } from '@/i18n/strings/personal-kb-cluster';
import { useLocale, pickByLocale, type Locale } from '@/lib/locale';
import { bcp47For } from '@/lib/format';

interface MemoryCell {
  readonly id: string;
  readonly personId: string;
  readonly cellKind: string;
  readonly key: string;
  readonly value: unknown;
  readonly confidence: string;
  readonly sourceTenantId: string | null;
  readonly capturedAt: string;
}

type FetchState =
  | { kind: 'loading' }
  | { kind: 'ok'; cells: ReadonlyArray<MemoryCell> }
  | { kind: 'consent-required' }
  | { kind: 'forbidden' }
  | { kind: 'error'; message: string };

function kindLabel(locale: Locale, kind: string): string {
  const map: Record<string, { readonly en: string; readonly sw: string }> = {
    preference: S.personalKbDetail.kindPreference,
    context: S.personalKbDetail.kindContext,
    'recurring-fact': S.personalKbDetail.kindRecurringFact,
    calibration: S.personalKbDetail.kindCalibration,
    sentiment: S.personalKbDetail.kindSentiment,
  };
  const entry = map[kind];
  return entry ? pickByLocale(locale, entry) : kind;
}

export function PersonalKbDetailPanel({
  personId,
  initialLocale,
}: {
  readonly personId: string;
  readonly initialLocale?: Locale;
}) {
  const locale = useLocale(initialLocale);
  const [state, setState] = useState<FetchState>({ kind: 'loading' });

  const load = useCallback(async () => {
    setState({ kind: 'loading' });
    try {
      // apiRequest prepends the gateway base, attaches the Supabase Bearer,
      // and unwraps the {success,data} envelope — so this is the cells array.
      const data = await apiRequest<ReadonlyArray<MemoryCell>>(
        `/api/v1/me/persons/${personId}/cells`,
        { method: 'GET' },
      );
      setState({ kind: 'ok', cells: data ?? [] });
    } catch (err) {
      // apiRequest throws ApiError on non-2xx. The 403 branch distinguishes
      // CONSENT_REQUIRED (opt-in banner) from a generic forbidden person.
      // The error body is the raw response text on `.message`; parse it for
      // the `error.code` the gateway sends.
      if (err instanceof ApiError && err.status === 403) {
        let code: string | undefined;
        try {
          const parsed = JSON.parse(err.message) as {
            error?: { code?: string };
          };
          code = parsed.error?.code;
        } catch {
          code = undefined;
        }
        if (code === 'CONSENT_REQUIRED') {
          setState({ kind: 'consent-required' });
        } else {
          setState({ kind: 'forbidden' });
        }
        return;
      }
      // Localize the gateway error by its stable CODE — never the raw English
      // `.message` (rendering that under `sw` is language MIXING). NOTE: the
      // 403 branch above parses err.message as the raw JSON BODY (internal,
      // not rendered) — that stays.
      setState({ kind: 'error', message: localizeError(err, locale) });
    }
  }, [personId, locale]);

  useEffect(() => {
    void load();
  }, [load]);

  if (state.kind === 'loading') {
    return (
      <div
        className="mt-6 space-y-3"
        role="status"
        aria-label={pickByLocale(locale, S.personalKbDetail.loading)}
      >
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-20 rounded-lg border border-border" />
        ))}
      </div>
    );
  }
  if (state.kind === 'error') {
    return (
      <Alert variant="error" className="mt-6">
        {state.message}
      </Alert>
    );
  }
  if (state.kind === 'forbidden') {
    return (
      <Alert variant="error" className="mt-6">
        {pickByLocale(locale, S.personalKbDetail.forbidden)}
      </Alert>
    );
  }
  if (state.kind === 'consent-required') {
    // No consent-grant endpoint exists yet (the gateway personal-KB router
    // is GET-only) and there is no "Share consent" settings screen — so we
    // render an honest state instead of directing the owner to a phantom
    // page or exposing a no-op grant button (no dead-end).
    return (
      <Alert variant="warning" className="mt-6">
        <h2 className="font-display text-xl text-foreground">
          {pickByLocale(locale, P.consentTitle)}
        </h2>
        <p className="mt-3 text-sm">
          {pickByLocale(locale, P.consentBody)}
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          {pickByLocale(locale, P.consentNotAvailable)}
        </p>
      </Alert>
    );
  }

  const cells = state.cells;
  if (cells.length === 0) {
    return (
      <p className="mt-6 text-sm text-muted-foreground">
        {pickByLocale(locale, S.personalKbDetail.noCells)}
      </p>
    );
  }

  // Group by cellKind for visual structure.
  const grouped = cells.reduce<Record<string, MemoryCell[]>>(
    (acc, cell) => {
      const list = acc[cell.cellKind] ?? [];
      list.push(cell);
      acc[cell.cellKind] = list;
      return acc;
    },
    {},
  );

  return (
    <section className="mt-6 space-y-6">
      {Object.entries(grouped).map(([kind, group]) => (
        <div
          key={kind}
          className="rounded-lg border border-border bg-surface p-4"
        >
          <h2 className="font-display text-xl text-foreground">
            {kindLabel(locale, kind)}
            <span className="ml-2 text-xs text-muted-foreground">({group.length})</span>
          </h2>
          <ul className="mt-3 space-y-2">
            {group.map((cell) => (
              <li
                key={cell.id}
                className="rounded border border-border bg-background p-3"
              >
                <p className="font-medium text-foreground">{cell.key}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {typeof cell.value === 'string'
                    ? cell.value
                    : JSON.stringify(cell.value)}
                </p>
                <p className="mt-1 text-xxs text-muted-foreground">
                  {pickByLocale(locale, S.personalKbDetail.captured)}{' '}
                  {new Date(cell.capturedAt).toLocaleString(bcp47For(locale))} ·{' '}
                  {pickByLocale(locale, S.personalKbDetail.confidence)}{' '}
                  {cell.confidence}
                  {cell.sourceTenantId ? (
                    <>
                      {' '}·{' '}
                      {pickByLocale(locale, S.personalKbDetail.fromTenant)}{' '}
                      {cell.sourceTenantId.slice(0, 8)}…
                    </>
                  ) : null}
                </p>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
