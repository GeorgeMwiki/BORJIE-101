'use client';

import {
  Skeleton,
  EmptyState,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@borjie/design-system';
import {
  useActivationFunnelQuery,
  useCohortsQuery,
  type FunnelStep,
  type Cohort,
} from '@/lib/internal/queries/analytics';
import { DataSourceBadge } from '../DataSourceBadge';
import { useLocale, pickByLocale, type Locale } from '@/lib/locale';
import { localizeApiError } from '@borjie/error-catalog';

const S = {
  funnelTitle: { en: 'Activation funnel', sw: 'Funeli ya uwezeshaji' },
  funnelEmpty: {
    en: 'No activation events recorded yet in this window.',
    sw: 'Hakuna matukio ya uwezeshaji yaliyorekodiwa bado katika kipindi hiki.',
  },
  cohortTitle: { en: 'Signup cohorts & activation', sw: 'Makundi ya usajili na uwezeshaji' },
  cohortEmpty: { en: 'No signup cohorts yet', sw: 'Hakuna makundi ya usajili bado' },
  cohortEmptyBody: {
    en: 'Cohorts appear here once tenants sign up.',
    sw: 'Makundi huonekana hapa mara wateja wanaposajiliwa.',
  },
  colCohort: { en: 'Cohort', sw: 'Kundi' },
  colSignedUp: { en: 'Signed up', sw: 'Waliosajili' },
  colActivated: { en: 'Activated', sw: 'Walioamilishwa' },
  colActivation: { en: 'Activation', sw: 'Uwezeshaji' },
  percent: { en: 'percent', sw: 'asilimia' },
} as const;

function SectionSkeleton(): JSX.Element {
  return (
    <section className="rounded-lg border border-border bg-surface p-6">
      <Skeleton className="mb-4 h-5 w-1/3 rounded-md" />
      <div className="space-y-2">
        <Skeleton className="h-3 w-full rounded-full" />
        <Skeleton className="h-3 w-5/6 rounded-full" />
        <Skeleton className="h-3 w-2/3 rounded-full" />
      </div>
    </section>
  );
}

/**
 * Live HQ product analytics.
 *
 * Binds to:
 *   GET /api/v1/mining/internal/analytics/funnel  — distinct tenants per
 *       ordered activation milestone (within a 90-day window).
 *   GET /api/v1/mining/internal/analytics/cohorts — monthly signup cohorts
 *       + an activation retention proxy.
 *
 * Every number is computed from the real append-only `activation_events`
 * log — no fixtures. Empty until milestone events accrue.
 */
export function AnalyticsView({
  initialLocale,
}: {
  readonly initialLocale?: Locale;
} = {}): JSX.Element {
  const locale = useLocale(initialLocale);
  const funnel = useActivationFunnelQuery(90);
  const cohorts = useCohortsQuery();

  return (
    <div className="space-y-6">
      <FunnelSection
        locale={locale}
        isPending={funnel.isPending}
        error={funnel.isError ? localizeApiError(funnel.error, locale) : null}
        steps={funnel.data?.steps ?? []}
        windowDays={funnel.data?.windowDays ?? 90}
      />
      <CohortSection
        locale={locale}
        isPending={cohorts.isPending}
        error={cohorts.isError ? localizeApiError(cohorts.error, locale) : null}
        cohorts={cohorts.data?.cohorts ?? []}
      />
      <DataSourceBadge source="live" locale={locale} />
    </div>
  );
}

function FunnelSection({
  locale,
  isPending,
  error,
  steps,
  windowDays,
}: {
  readonly locale: Locale;
  readonly isPending: boolean;
  readonly error: string | null;
  readonly steps: ReadonlyArray<FunnelStep>;
  readonly windowDays: number;
}): JSX.Element {
  if (isPending) return <SectionSkeleton />;
  const max = steps[0]?.count ?? 0;
  return (
    <section className="rounded-lg border border-border bg-surface p-6">
      <h3 className="text-sm font-medium text-foreground mb-4">
        {pickByLocale(locale, S.funnelTitle)} ({windowDays}d)
      </h3>
      {error ? (
        <p className="text-sm text-danger">{error}</p>
      ) : steps.every((s) => s.count === 0) ? (
        <p className="text-sm text-muted-foreground">
          {pickByLocale(locale, S.funnelEmpty)}
        </p>
      ) : (
        <ul className="space-y-2">
          {steps.map((step) => {
            const pct = max > 0 ? Math.round((step.count / max) * 100) : 0;
            return (
              <li key={step.eventType} className="flex items-center gap-4">
                <span className="w-48 shrink-0 text-sm text-muted-foreground">
                  {step.label}
                </span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-sunken">
                  <div
                    className="h-full bg-signal-500"
                    style={{ width: `${pct}%` }}
                    aria-label={`${pct} ${pickByLocale(locale, S.percent)}`}
                  />
                </div>
                <span className="w-12 text-right text-sm tabular-nums text-muted-foreground">
                  {step.count}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function CohortSection({
  locale,
  isPending,
  error,
  cohorts,
}: {
  readonly locale: Locale;
  readonly isPending: boolean;
  readonly error: string | null;
  readonly cohorts: ReadonlyArray<Cohort>;
}): JSX.Element {
  if (isPending) return <SectionSkeleton />;
  return (
    <section className="rounded-lg border border-border bg-surface p-6">
      <h3 className="text-sm font-medium text-foreground mb-4">
        {pickByLocale(locale, S.cohortTitle)}
      </h3>
      {error ? (
        <p className="text-sm text-danger">{error}</p>
      ) : cohorts.length === 0 ? (
        <EmptyState
          title={pickByLocale(locale, S.cohortEmpty)}
          description={pickByLocale(locale, S.cohortEmptyBody)}
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{pickByLocale(locale, S.colCohort)}</TableHead>
              <TableHead className="text-right">{pickByLocale(locale, S.colSignedUp)}</TableHead>
              <TableHead className="text-right">{pickByLocale(locale, S.colActivated)}</TableHead>
              <TableHead className="text-right">{pickByLocale(locale, S.colActivation)}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {cohorts.map((row) => (
              <TableRow key={row.cohort}>
                <TableCell className="text-foreground">{row.cohort}</TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {row.signedUp}
                </TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {row.activated}
                </TableCell>
                <TableCell className="text-right tabular-nums text-signal-500">
                  {row.activationPct}%
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}
