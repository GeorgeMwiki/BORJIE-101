'use client';

import Link from 'next/link';
import { Card } from '@borjie/design-system';
import { useDashboardTenants } from '@/lib/internal/queries/dashboard';
import { useLocale, pickByLocale, type Locale } from '@/lib/locale';

const S = {
  heading: { en: 'Tenants', sw: 'Wateja' },
  totalProvisioned: { en: 'total provisioned', sw: 'jumla zilizosajiliwa' },
  directory: { en: 'Directory →', sw: 'Orodha →' },
  unableToLoad: { en: 'Unable to load tenants', sw: 'Imeshindwa kupakia wateja' },
  empty: {
    en: 'No tenants yet. Provision one from the directory.',
    sw: 'Hakuna wateja bado. Sajili mmoja kutoka kwenye orodha.',
  },
  // "{name} unavailable" composed per-locale (Swahili word order differs).
  unavailable: { en: '{name} unavailable', sw: '{name} haipatikani' },
} as const;

// Tenant plan / status arrive as open machine tokens on the wire. Map the
// known values to per-locale labels; an unknown token falls back to the raw
// (locale-neutral) string rather than ever rendering a foreign word.
const PLAN_LABEL: Record<string, { en: string; sw: string }> = {
  starter: { en: 'starter', sw: 'anzio' },
  growth: { en: 'growth', sw: 'ukuaji' },
  scale: { en: 'scale', sw: 'kipimo' },
  enterprise: { en: 'enterprise', sw: 'shirika' },
};

const STATUS_LABEL: Record<string, { en: string; sw: string }> = {
  active: { en: 'active', sw: 'hai' },
  suspended: { en: 'suspended', sw: 'imesimamishwa' },
  pending: { en: 'pending', sw: 'inasubiri' },
  trial: { en: 'trial', sw: 'jaribio' },
  unknown: { en: 'unknown', sw: 'haijulikani' },
};

function labelFor(
  table: Record<string, { en: string; sw: string }>,
  token: string,
  locale: Locale,
): string {
  const entry = table[token.toLowerCase()];
  return entry ? pickByLocale(locale, entry) : token;
}

/**
 * Tenants overview — top-left panel.
 *
 * Total tenants + the five most recent provision rows. Links to the
 * internal tenant directory for deep operations (suspend, plan, etc.).
 */
export function TenantsOverviewPanel(): JSX.Element {
  const locale = useLocale();
  const query = useDashboardTenants();

  if (query.isLoading) {
    return <PanelSkeleton testId="admin-dashboard-tenants" />;
  }

  if (query.error || !query.data) {
    return (
      <PanelError
        title={pickByLocale(locale, S.unavailable).replace(
          '{name}',
          pickByLocale(locale, S.heading),
        )}
        message={
          query.error instanceof Error
            ? query.error.message
            : pickByLocale(locale, S.unableToLoad)
        }
        testId="admin-dashboard-tenants"
      />
    );
  }

  const { total, recent } = query.data;

  return (
    <Card className="p-5" data-testid="admin-dashboard-tenants">
      <header className="mb-3 flex items-start justify-between">
        <div>
          <h2 className="text-caption uppercase tracking-widest text-neutral-500">
            {pickByLocale(locale, S.heading)}
          </h2>
          <p className="mt-1 font-display text-3xl text-foreground">
            {total}
          </p>
          <p className="text-xs text-neutral-500">
            {pickByLocale(locale, S.totalProvisioned)}
          </p>
        </div>
        <Link
          href="/internal/tenants"
          className="text-xs text-signal-500 underline underline-offset-4"
        >
          {pickByLocale(locale, S.directory)}
        </Link>
      </header>
      {recent.length === 0 ? (
        <p
          className="mt-2 text-sm text-neutral-400"
          data-testid="admin-dashboard-tenants-empty"
        >
          {pickByLocale(locale, S.empty)}
        </p>
      ) : (
        <ul className="mt-2 flex flex-col gap-2 text-sm">
          {recent.map((row) => (
            <li
              key={row.id}
              className="flex items-baseline justify-between gap-3"
              data-testid="admin-dashboard-tenants-row"
            >
              <span className="truncate text-foreground">{row.name}</span>
              <span className="text-xs uppercase tracking-wide text-neutral-500">
                {labelFor(PLAN_LABEL, row.plan, locale)} ·{' '}
                {labelFor(STATUS_LABEL, row.status, locale)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

interface PanelSkeletonProps {
  readonly testId: string;
}

function PanelSkeleton({ testId }: PanelSkeletonProps): JSX.Element {
  return (
    <div
      className="h-44 animate-pulse rounded-lg border border-border bg-surface/40"
      data-testid={`${testId}-skeleton`}
    />
  );
}

interface PanelErrorProps {
  readonly title: string;
  readonly message: string;
  readonly testId: string;
}

function PanelError({
  title,
  message,
  testId,
}: PanelErrorProps): JSX.Element {
  return (
    <article
      className="rounded-lg border border-warning/40 bg-warning-subtle/10 p-5"
      data-testid={`${testId}-error`}
    >
      <h2 className="text-caption uppercase tracking-widest text-warning">
        {title}
      </h2>
      <p className="mt-2 text-sm text-neutral-300">{message}</p>
    </article>
  );
}
