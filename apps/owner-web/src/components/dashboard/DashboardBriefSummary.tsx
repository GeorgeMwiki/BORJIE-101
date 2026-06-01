'use client';

import Link from 'next/link';
import { ArrowRight, Brain, Calculator, FileCheck, Users } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useT } from '@/i18n/t.client';
import { useOwnerBrief } from '@/lib/queries/owner-brief';
import type {
  AdvisorSlot,
  DecisionItem,
  LicenceItem,
  OwnerBriefPayload,
} from '@/lib/queries/owner-brief';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/Card';

/**
 * Real-data summary that replaces the former STATIC top-of-dashboard copy
 * (fabricated metric tiles, invented "today's actions", fake "this week"
 * deadlines and a scripted "brain stream").
 *
 * Single source: `GET /api/v1/owner/brief` (the same endpoint the live
 * surface below already consumes). Every block degrades to an explicit
 * empty state — never to invented numbers — so a brand-new owner with no
 * data sees an honest "your cockpit fills as you operate" prompt.
 *
 * Locale-strict: all copy flows through `useT()`; zero hardcoded literals.
 */
export function DashboardBriefSummary(): JSX.Element {
  const t = useT();
  const query = useOwnerBrief();
  const brief = query.data?.brief ?? null;

  return (
    <div className="space-y-10" data-testid="dashboard-brief-summary">
      <MetricStrip brief={brief} offline={Boolean(query.error)} t={t} />
      <TodaysActions decisions={brief?.decisions.items ?? []} t={t} />
      <ThisWeek licences={brief?.licenceHealth.items ?? []} t={t} />
      <BrainStream
        advisor={brief?.advisor ?? null}
        decisions={brief?.decisions.items ?? []}
        t={t}
      />
    </div>
  );
}

type T = ReturnType<typeof useT>;

interface MetricStripProps {
  readonly brief: OwnerBriefPayload | null;
  readonly offline: boolean;
  readonly t: T;
}

function MetricStrip({ brief, offline, t }: MetricStripProps): JSX.Element {
  const licence = brief?.licenceHealth;
  const decisions = brief?.decisions;
  const shifts = brief?.dailyBrief.shiftsToday ?? 0;

  return (
    <section aria-labelledby="todays-brief-heading">
      <SectionHeading id="todays-brief-heading" label={t('dashboard.todaysBrief')} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <MetricTile
          label={t('dashboard.metricOpenLicences')}
          value={offline ? '—' : `${licence?.totalCount ?? 0}`}
          sub={licenceSub(licence?.atRiskCount ?? 0, licence?.totalCount ?? 0, t)}
          icon={FileCheck}
        />
        <MetricTile
          label={t('dashboard.metricDecisionsLabel')}
          value={decisionValue(decisions?.pendingCount ?? 0, offline, t)}
          sub={decisionSub(decisions?.pendingCount ?? 0, t)}
          icon={Calculator}
        />
        <MetricTile
          label={t('dashboard.metricWorkforce')}
          value={offline ? '—' : `${shifts}`}
          sub={shiftSub(shifts, t)}
          icon={Users}
        />
      </div>
    </section>
  );
}

function licenceSub(atRisk: number, total: number, t: T): string {
  if (total === 0) return t('dashboard.metricLicencesNoneSub');
  if (atRisk > 0) return t('dashboard.metricLicencesAtRiskSub', { count: atRisk });
  return t('dashboard.metricOpenLicencesSub');
}

function decisionValue(pending: number, offline: boolean, t: T): string {
  if (offline) return '—';
  return pending === 0 ? t('dashboard.metricDecisionsValueNone') : `${pending}`;
}

function decisionSub(pending: number, t: T): string {
  return pending === 0
    ? t('dashboard.metricDecisionsNoneSub')
    : t('dashboard.metricDecisionsSub', { count: pending });
}

function shiftSub(shifts: number, t: T): string {
  return shifts === 0
    ? t('dashboard.metricWorkforceNoneSub')
    : t('dashboard.metricWorkforceShiftsSub', { count: shifts });
}

interface TodaysActionsProps {
  readonly decisions: ReadonlyArray<DecisionItem>;
  readonly t: T;
}

function TodaysActions({ decisions, t }: TodaysActionsProps): JSX.Element {
  const items = decisions.slice(0, 4);
  return (
    <section aria-labelledby="todays-actions-heading">
      <SectionHeading id="todays-actions-heading" label={t('dashboard.todaysActions')} />
      {items.length === 0 ? (
        <EmptyRow message={t('dashboard.actionsEmpty')} />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {items.map((item) => (
            <ActionCard
              key={item.id}
              title={item.summary}
              context={item.kind}
              ctaLabel={t('dashboard.actionReviewDecision')}
              ctaHref="/master-brain"
            />
          ))}
        </div>
      )}
    </section>
  );
}

interface ThisWeekProps {
  readonly licences: ReadonlyArray<LicenceItem>;
  readonly t: T;
}

function ThisWeek({ licences, t }: ThisWeekProps): JSX.Element {
  const upcoming = licences
    .filter((l) => l.atRisk || (l.daysToExpiry !== null && l.daysToExpiry <= 30))
    .slice(0, 3);
  return (
    <section aria-labelledby="this-week-heading">
      <SectionHeading id="this-week-heading" label={t('dashboard.thisWeek')} />
      {upcoming.length === 0 ? (
        <EmptyRow message={t('dashboard.thisWeekEmpty')} />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {upcoming.map((l) => (
            <EventCard
              key={l.id}
              title={l.number ?? l.kind ?? t('dashboard.eventLicenceExpiry')}
              when={expiryLabel(l.daysToExpiry, t)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function expiryLabel(days: number | null, t: T): string {
  if (days === null) return t('dashboard.eventLicenceExpirySoon');
  return t('dashboard.eventLicenceExpiresInDays', { count: days });
}

interface BrainStreamProps {
  readonly advisor: AdvisorSlot | null;
  readonly decisions: ReadonlyArray<DecisionItem>;
  readonly t: T;
}

function BrainStream({ advisor, decisions, t }: BrainStreamProps): JSX.Element {
  const rows = decisions.slice(0, 3);
  const hasContent = Boolean(advisor) || rows.length > 0;
  return (
    <section aria-labelledby="brain-stream-heading" className="space-y-3">
      <header className="flex items-center justify-between">
        <h2
          id="brain-stream-heading"
          className="text-badge font-semibold uppercase tracking-eyebrow-wide text-neutral-400"
        >
          {t('dashboard.brainStream')}
        </h2>
        <Link
          href="/master-brain"
          className="inline-flex items-center gap-1 text-xs font-semibold text-signal-500 hover:underline"
        >
          {t('dashboard.viewAll')}
          <ArrowRight className="h-3 w-3" />
        </Link>
      </header>
      <Card variant="outline" className="border-border/60 bg-surface/40">
        <CardHeader bordered>
          <CardTitle size="sm">{t('dashboard.brainRecentTitle')}</CardTitle>
          <CardDescription>{t('dashboard.brainRecentDesc')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 pt-4">
          {hasContent ? (
            <>
              {advisor ? (
                <BrainStreamRow
                  title={t('dashboard.brainAdvisorTitle')}
                  detail={advisor.insight}
                />
              ) : null}
              {rows.map((d) => (
                <BrainStreamRow key={d.id} title={d.summary} detail={d.kind} />
              ))}
            </>
          ) : (
            <EmptyRow message={t('dashboard.brainStreamEmpty')} />
          )}
        </CardContent>
      </Card>
    </section>
  );
}

// ------------------------------------------------------------------
// Local primitives — small, self-contained, no cross-page leak.
// ------------------------------------------------------------------

interface SectionHeadingProps {
  readonly id: string;
  readonly label: string;
}

function SectionHeading({ id, label }: SectionHeadingProps): JSX.Element {
  return (
    <h2
      id={id}
      className="mb-3 text-badge font-semibold uppercase tracking-eyebrow-wide text-neutral-400"
    >
      {label}
    </h2>
  );
}

function EmptyRow({ message }: { readonly message: string }): JSX.Element {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-dashed border-border/60 bg-surface/30 px-4 py-5 text-sm text-neutral-400">
      <Brain className="h-4 w-4 shrink-0 text-neutral-500" />
      <span>{message}</span>
    </div>
  );
}

interface MetricTileProps {
  readonly label: string;
  readonly value: string;
  readonly sub: string;
  readonly icon: LucideIcon;
}

function MetricTile({ label, value, sub, icon: Icon }: MetricTileProps): JSX.Element {
  return (
    <Card variant="default" className="border-border/60">
      <CardContent className="flex items-start justify-between p-6">
        <div className="space-y-1">
          <p className="text-badge font-semibold uppercase tracking-eyebrow-wide text-neutral-400">
            {label}
          </p>
          <p className="font-display text-3xl text-foreground">{value}</p>
          <p className="text-xs text-neutral-400">{sub}</p>
        </div>
        <div className="rounded-xl bg-signal-500/10 p-2.5 text-signal-500">
          <Icon className="h-5 w-5" />
        </div>
      </CardContent>
    </Card>
  );
}

interface ActionCardProps {
  readonly title: string;
  readonly context: string;
  readonly ctaLabel: string;
  readonly ctaHref: string;
}

function ActionCard({
  title,
  context,
  ctaLabel,
  ctaHref,
}: ActionCardProps): JSX.Element {
  return (
    <Card variant="default" hoverable className="border-border/60">
      <CardContent className="flex items-start justify-between gap-4 p-6">
        <div className="space-y-1">
          <h3 className="text-base font-semibold text-foreground">{title}</h3>
          <p className="text-sm text-neutral-400">{context}</p>
        </div>
        <Link
          href={ctaHref}
          className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-surface"
        >
          {ctaLabel}
          <ArrowRight className="h-3 w-3" />
        </Link>
      </CardContent>
    </Card>
  );
}

interface EventCardProps {
  readonly title: string;
  readonly when: string;
}

function EventCard({ title, when }: EventCardProps): JSX.Element {
  return (
    <Link
      href="/licences"
      className="group relative block overflow-hidden rounded-lg border border-border/60 bg-surface/60 p-5 before:absolute before:left-0 before:top-0 before:h-full before:w-rail before:bg-warning hover:bg-surface"
    >
      <div className="flex items-center gap-2 text-xs text-neutral-400">
        <FileCheck className="h-3.5 w-3.5" />
        <span>{when}</span>
      </div>
      <div className="mt-2 text-base font-semibold text-foreground">{title}</div>
      <div className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-signal-500 group-hover:underline">
        <ArrowRight className="h-3 w-3" />
      </div>
    </Link>
  );
}

interface BrainStreamRowProps {
  readonly title: string;
  readonly detail: string;
}

function BrainStreamRow({ title, detail }: BrainStreamRowProps): JSX.Element {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-signal-500" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-foreground">{title}</div>
        <div className="truncate text-xs text-neutral-400">{detail}</div>
      </div>
    </div>
  );
}
