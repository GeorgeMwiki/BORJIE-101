'use client';

import { Card } from '@borjie/design-system';
import { useDashboardPilotErrors } from '@/lib/internal/queries/dashboard';
import { useLocale, pickByLocale } from '@/lib/locale';
import { bcp47For } from '@/lib/format';

// Every rendered string in BOTH locales — one language per active locale,
// never English-under-sw. The PanelError message is passed in as a
// localized string (or a gateway error), so only the chrome lives here.
const S = {
  unavailableMessage: { en: 'Pilot error stream unavailable', sw: 'Mtiririko wa makosa ya majaribio haupatikani' },
  heading: { en: 'Pilot errors', sw: 'Makosa ya majaribio' },
  unauthorized: {
    en: 'Requires admin-tier sign-in. Reauthenticate from the HQ home.',
    sw: 'Inahitaji kuingia kwa kiwango cha msimamizi. Thibitisha upya kutoka ukurasa wa nyumbani wa HQ.',
  },
  capturedCount: { en: 'last 10 captured', sw: '10 za mwisho zilizonaswa' },
  empty: { en: 'No pilot errors in the current window.', sw: 'Hakuna makosa ya majaribio katika dirisha la sasa.' },
  unavailableTitle: { en: 'Pilot errors unavailable', sw: 'Makosa ya majaribio hayapatikani' },
} as const;

/**
 * Pilot errors panel — top-centre.
 *
 * Reads from the gateway's in-memory pilot-error ring buffer
 * (`/api/v1/pilot/errors`). Displays the latest 10 events with cohort
 * tags. 401/403 collapses to an env-missing copy because pilot errors
 * are admin-tier only.
 */
export function PilotErrorsPanel(): JSX.Element {
  const query = useDashboardPilotErrors();
  const locale = useLocale();

  if (query.isLoading) {
    return (
      <div
        className="h-44 animate-pulse rounded-lg border border-border bg-surface/40"
        data-testid="admin-dashboard-pilot-errors-skeleton"
      />
    );
  }

  const data = query.data;
  if (!data || data.state === 'failed') {
    return (
      <PanelError
        title={pickByLocale(locale, S.unavailableTitle)}
        message={
          data?.message ??
          (query.error instanceof Error
            ? query.error.message
            : pickByLocale(locale, S.unavailableMessage))
        }
      />
    );
  }

  if (data.state === 'unauthorized') {
    return (
      <article
        className="rounded-lg border border-border bg-surface p-5"
        data-testid="admin-dashboard-pilot-errors-unauth"
      >
        <header className="mb-3">
          <h2 className="text-caption uppercase tracking-widest text-neutral-500">
            {pickByLocale(locale, S.heading)}
          </h2>
        </header>
        <p className="text-sm text-neutral-400">
          {pickByLocale(locale, S.unauthorized)}
        </p>
      </article>
    );
  }

  return (
    <Card className="p-5" data-testid="admin-dashboard-pilot-errors">
      <header className="mb-3 flex items-start justify-between">
        <div>
          <h2 className="text-caption uppercase tracking-widest text-neutral-500">
            {pickByLocale(locale, S.heading)}
          </h2>
          <p className="mt-1 font-display text-3xl text-foreground">
            {data.rows.length.toLocaleString(bcp47For(locale))}
          </p>
          <p className="text-xs text-neutral-500">
            {pickByLocale(locale, S.capturedCount)}
          </p>
        </div>
      </header>
      {data.rows.length === 0 ? (
        <p
          className="text-sm text-neutral-400"
          data-testid="admin-dashboard-pilot-errors-empty"
        >
          {pickByLocale(locale, S.empty)}
        </p>
      ) : (
        <ul className="flex flex-col gap-2 text-sm">
          {data.rows.slice(0, 5).map((row) => (
            <li
              key={row.id}
              className="border-l-2 border-warning/40 pl-2"
              data-testid="admin-dashboard-pilot-errors-row"
            >
              <div className="truncate text-foreground">{row.message}</div>
              <div className="text-xs text-neutral-500">
                {row.cohort} ·{' '}
                {new Date(row.capturedAt).toLocaleTimeString(bcp47For(locale), {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function PanelError({
  title,
  message,
}: {
  readonly title: string;
  readonly message: string;
}) {
  return (
    <article
      className="rounded-lg border border-warning/40 bg-warning-subtle/10 p-5"
      data-testid="admin-dashboard-pilot-errors-error"
    >
      <h2 className="text-caption uppercase tracking-widest text-warning">
        {title}
      </h2>
      <p className="mt-2 text-sm text-neutral-300">{message}</p>
    </article>
  );
}
