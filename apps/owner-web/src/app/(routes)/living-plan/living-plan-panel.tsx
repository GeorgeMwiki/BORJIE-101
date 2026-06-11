'use client';

/**
 * Living-plan client panel.
 *
 * Fetches the five read endpoints, renders a calm health meter + GTD-partitioned
 * cards. Locale-PURE: every string is resolved through `pickByLocale` / a single
 * `titleFor` helper, so an `en` session shows zero Swahili and a `sw` session
 * shows zero English — never both, never a hardcoded 'en-US'.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import { useLocale, pickByLocale, type Locale } from '@/lib/locale';

// ── Wire shapes (mirror the api-gateway living-plan route) ───────────────────

type CommitmentClass =
  | 'next_action'
  | 'waiting_for'
  | 'tickler'
  | 'someday';

type CommitmentStatus =
  | 'open'
  | 'scheduled'
  | 'overdue'
  | 'blocked'
  | 'done'
  | 'reopened'
  | 'needs_approval'
  | 'dead_letter';

interface PlanItem {
  readonly id: string;
  readonly class: CommitmentClass;
  readonly kind: string;
  readonly title: string;
  readonly titleSw: string;
  readonly rationale: string;
  readonly status: CommitmentStatus;
  readonly sovereign: boolean;
  readonly triggerKind: 'time' | 'event' | 'condition';
  readonly triggerEventKey: string | null;
  readonly triggerDueAt: string | null;
  readonly confirmedAt: string | null;
  readonly confirmationKind: string | null;
  readonly blockedReason: string | null;
  readonly evidenceIds: ReadonlyArray<string>;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface PlanHealth {
  readonly open: number;
  readonly done: number;
  readonly overdue: number;
  readonly deferred: number;
  readonly blocked: number;
  readonly progress: number;
  readonly hasOverdueWarning: boolean;
}

interface Summary {
  readonly health: PlanHealth;
  readonly counts: {
    readonly nextActions: number;
    readonly waitingFor: number;
    readonly tickler: number;
    readonly someday: number;
    readonly overdue: number;
    readonly done: number;
  };
  readonly empty: boolean;
  readonly nextDueAt: string | null;
}

interface PlanData {
  readonly summary: Summary;
  readonly nextActions: ReadonlyArray<PlanItem>;
  readonly waitingFor: ReadonlyArray<PlanItem>;
  readonly tickler: ReadonlyArray<PlanItem>;
  readonly overdue: ReadonlyArray<PlanItem>;
  readonly someday: ReadonlyArray<PlanItem>;
  readonly done: ReadonlyArray<PlanItem>;
}

// ── Locale-pure copy ─────────────────────────────────────────────────────────

const COPY = {
  eyebrow: { en: 'Mr. Mwikila', sw: 'Bw. Mwikila' },
  heading: { en: 'Living plan', sw: 'Mpango hai' },
  gloss: {
    en: 'Every commitment Mr. Mwikila is holding for you — what is next, what he is waiting on, and what is already done.',
    sw: 'Kila ahadi Bw. Mwikila anayoishikilia kwa niaba yako — kinachofuata, anachosubiri, na kilichokamilika.',
  },
  health: { en: 'Plan health', sw: 'Afya ya mpango' },
  progressLabel: { en: 'Completed', sw: 'Imekamilika' },
  open: { en: 'Open', sw: 'Wazi' },
  done: { en: 'Done', sw: 'Imekamilika' },
  overdue: { en: 'Overdue', sw: 'Imechelewa' },
  deferred: { en: 'Someday', sw: 'Siku moja' },
  blocked: { en: 'Blocked', sw: 'Imezuiwa' },
  nextDue: { en: 'Next due', sw: 'Inayofuata' },
  nextActions: { en: 'Next actions', sw: 'Hatua zinazofuata' },
  waitingFor: { en: 'Waiting for', sw: 'Inasubiri' },
  ticklerUpcoming: { en: 'Upcoming', sw: 'Zinazokuja' },
  somedaySection: { en: 'Someday', sw: 'Siku moja' },
  overdueSection: { en: 'Overdue', sw: 'Imechelewa' },
  pastSection: { en: 'Completed', sw: 'Zilizokamilika' },
  sovereign: { en: 'Owner sign-off', sw: 'Idhini ya mmiliki' },
  proofClosed: { en: 'Closed with proof', sw: 'Imefungwa kwa uthibitisho' },
  noTrigger: { en: 'No deadline set', sw: 'Hakuna tarehe ya mwisho' },
  whenEvent: { en: 'When', sw: 'Wakati' },
  dueOn: { en: 'Due', sw: 'Inastahili' },
  errorTitle: {
    en: 'Could not load your plan',
    sw: 'Imeshindwa kupakia mpango wako',
  },
  retry: { en: 'Try again', sw: 'Jaribu tena' },
  emptyAllClear: {
    en: 'Mr. Mwikila is keeping your plan — nothing due right now.',
    sw: 'Bw. Mwikila anashikilia mpango wako — hakuna kinachostahili sasa.',
  },
  emptySection: { en: 'Nothing here', sw: 'Hakuna chochote hapa' },
} as const;

// Friendly status + class + trigger-event labels, strictly per-locale.
const STATUS_LABEL: Record<CommitmentStatus, { en: string; sw: string }> = {
  open: { en: 'Open', sw: 'Wazi' },
  scheduled: { en: 'Scheduled', sw: 'Imepangwa' },
  overdue: { en: 'Overdue', sw: 'Imechelewa' },
  blocked: { en: 'Blocked', sw: 'Imezuiwa' },
  done: { en: 'Done', sw: 'Imekamilika' },
  reopened: { en: 'Reopened', sw: 'Imefunguliwa tena' },
  needs_approval: { en: 'Needs approval', sw: 'Inahitaji idhini' },
  dead_letter: { en: 'Needs triage', sw: 'Inahitaji ukaguzi' },
};

// A short human gloss for the common event triggers (the rest fall back to the
// raw key, which is itself language-neutral).
const EVENT_LABEL: Record<string, { en: string; sw: string }> = {
  'ledger.credit': { en: 'a payment lands', sw: 'malipo yanapokelewa' },
  'offtake.settled': { en: 'the off-take settles', sw: 'mauzo yanapokamilika' },
  'royalty.settled': { en: 'royalty settles', sw: 'mrabaha unapolipwa' },
};

function titleFor(item: PlanItem, locale: Locale): string {
  return pickByLocale(locale, { en: item.title, sw: item.titleSw });
}

/**
 * Format a date strictly for the active locale — never a hardcoded 'en-US'.
 * Uses a numeric-leaning style so month rendering stays locale-correct.
 */
function formatDate(iso: string, locale: Locale): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const bcp47 = locale === 'sw' ? 'sw-TZ' : 'en-GB';
  return new Intl.DateTimeFormat(bcp47, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

/** The human trigger line: "Due 1 Jul 2026" / "When a payment lands". */
function triggerLine(item: PlanItem, locale: Locale): string {
  if (item.triggerKind === 'time' && item.triggerDueAt) {
    return `${pickByLocale(locale, COPY.dueOn)} ${formatDate(item.triggerDueAt, locale)}`;
  }
  if (item.triggerEventKey) {
    const gloss = EVENT_LABEL[item.triggerEventKey];
    const phrase = gloss
      ? pickByLocale(locale, gloss)
      : item.triggerEventKey;
    return `${pickByLocale(locale, COPY.whenEvent)} ${phrase}`;
  }
  if (item.triggerDueAt) {
    return `${pickByLocale(locale, COPY.dueOn)} ${formatDate(item.triggerDueAt, locale)}`;
  }
  return pickByLocale(locale, COPY.noTrigger);
}

// ── Data fetch ───────────────────────────────────────────────────────────────

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = (await res.json()) as { success: boolean; data?: T };
  if (!json.success || json.data === undefined) {
    throw new Error('Request was not successful');
  }
  return json.data;
}

const BASE = '/api/v1/owner/living-plan';

async function loadPlan(): Promise<PlanData> {
  const [summary, upcoming, overdue, deferred, past] = await Promise.all([
    fetchJson<Summary>(`${BASE}/summary`),
    fetchJson<{
      nextActions: ReadonlyArray<PlanItem>;
      waitingFor: ReadonlyArray<PlanItem>;
      tickler: ReadonlyArray<PlanItem>;
    }>(`${BASE}/upcoming`),
    fetchJson<{ overdue: ReadonlyArray<PlanItem> }>(`${BASE}/overdue`),
    fetchJson<{ someday: ReadonlyArray<PlanItem> }>(`${BASE}/deferred`),
    fetchJson<{ done: ReadonlyArray<PlanItem> }>(`${BASE}/past`),
  ]);
  return {
    summary,
    nextActions: upcoming.nextActions,
    waitingFor: upcoming.waitingFor,
    tickler: upcoming.tickler,
    overdue: overdue.overdue,
    someday: deferred.someday,
    done: past.done,
  };
}

// ── Presentational pieces ────────────────────────────────────────────────────

function HealthMeter({
  health,
  nextDueAt,
  locale,
}: {
  health: PlanHealth;
  nextDueAt: string | null;
  locale: Locale;
}) {
  const pct = Math.round(health.progress * 100);
  const stats: ReadonlyArray<{
    key: string;
    label: string;
    value: number;
    warn?: boolean;
  }> = [
    { key: 'open', label: pickByLocale(locale, COPY.open), value: health.open },
    { key: 'done', label: pickByLocale(locale, COPY.done), value: health.done },
    {
      key: 'overdue',
      label: pickByLocale(locale, COPY.overdue),
      value: health.overdue,
      warn: health.overdue > 0,
    },
    {
      key: 'deferred',
      label: pickByLocale(locale, COPY.deferred),
      value: health.deferred,
    },
  ];

  return (
    <section
      aria-label={pickByLocale(locale, COPY.health)}
      className="rounded-2xl border border-border bg-surface p-6"
    >
      <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
        {/* Progress dial */}
        <div className="flex items-center gap-4">
          <div className="relative h-20 w-20 shrink-0">
            <svg viewBox="0 0 36 36" className="h-20 w-20 -rotate-90">
              <circle
                cx="18"
                cy="18"
                r="15.9155"
                fill="none"
                className="stroke-muted/40"
                strokeWidth="3"
              />
              <circle
                cx="18"
                cy="18"
                r="15.9155"
                fill="none"
                className={
                  health.hasOverdueWarning
                    ? 'stroke-amber-500'
                    : 'stroke-emerald-500'
                }
                strokeWidth="3"
                strokeLinecap="round"
                strokeDasharray={`${pct} ${100 - pct}`}
                style={{ transition: 'stroke-dasharray 600ms ease-out' }}
              />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="font-display text-xl tabular-nums text-foreground">
                {pct}%
              </span>
            </div>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-neutral-400">
              {pickByLocale(locale, COPY.health)}
            </p>
            <p className="mt-0.5 text-sm text-neutral-300">
              {pickByLocale(locale, COPY.progressLabel)}
            </p>
            {nextDueAt ? (
              <p className="mt-1 text-xs text-neutral-500">
                {pickByLocale(locale, COPY.nextDue)}:{' '}
                <span className="text-neutral-300">
                  {formatDate(nextDueAt, locale)}
                </span>
              </p>
            ) : null}
          </div>
        </div>

        {/* Stat chips */}
        <div className="grid flex-1 grid-cols-2 gap-3 sm:grid-cols-4">
          {stats.map((s) => (
            <div
              key={s.key}
              className={`rounded-xl border px-3 py-2.5 ${
                s.warn
                  ? 'border-amber-500/40 bg-amber-500/5'
                  : 'border-border bg-background'
              }`}
            >
              <p
                className={`font-display text-2xl tabular-nums ${
                  s.warn ? 'text-amber-400' : 'text-foreground'
                }`}
              >
                {s.value}
              </p>
              <p className="text-xs text-neutral-400">{s.label}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function StatusPill({
  status,
  locale,
}: {
  status: CommitmentStatus;
  locale: Locale;
}) {
  const tone =
    status === 'overdue'
      ? 'border-amber-500/40 bg-amber-500/10 text-amber-400'
      : status === 'blocked' || status === 'dead_letter'
        ? 'border-destructive/40 bg-destructive/5 text-destructive'
        : status === 'done'
          ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400'
          : 'border-border bg-foreground/5 text-neutral-300';
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${tone}`}
    >
      {pickByLocale(locale, STATUS_LABEL[status])}
    </span>
  );
}

function PlanItemRow({ item, locale }: { item: PlanItem; locale: Locale }) {
  return (
    <li className="rounded-xl border border-border bg-background p-4 transition-colors hover:border-foreground/20">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="text-sm font-medium leading-snug text-foreground">
          {titleFor(item, locale)}
        </h3>
        <div className="flex shrink-0 items-center gap-1.5">
          {item.sovereign ? (
            <span className="rounded-full border border-violet-500/40 bg-violet-500/10 px-2 py-0.5 text-[11px] text-violet-300">
              {pickByLocale(locale, COPY.sovereign)}
            </span>
          ) : null}
          <StatusPill status={item.status} locale={locale} />
        </div>
      </div>

      <p className="mt-1.5 text-xs leading-relaxed text-neutral-400">
        {item.rationale}
      </p>

      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-neutral-500">
        <span className="inline-flex items-center gap-1">
          <span aria-hidden className="text-neutral-600">
            ◷
          </span>
          {triggerLine(item, locale)}
        </span>
        {item.confirmedAt ? (
          <span className="inline-flex items-center gap-1 text-emerald-400/80">
            <span aria-hidden>✓</span>
            {pickByLocale(locale, COPY.proofClosed)}
            {item.confirmationKind ? ` · ${item.confirmationKind}` : ''}
          </span>
        ) : null}
        {item.blockedReason ? (
          <span className="text-destructive">{item.blockedReason}</span>
        ) : null}
      </div>
    </li>
  );
}

function PlanSection({
  title,
  items,
  locale,
  accent,
}: {
  title: string;
  items: ReadonlyArray<PlanItem>;
  locale: Locale;
  accent?: 'warning';
}) {
  return (
    <section className="rounded-2xl border border-border bg-surface p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2
          className={`text-sm font-semibold ${
            accent === 'warning' ? 'text-amber-400' : 'text-foreground'
          }`}
        >
          {title}
        </h2>
        <span className="rounded-full bg-foreground/5 px-2 py-0.5 text-xs tabular-nums text-neutral-400">
          {items.length}
        </span>
      </div>
      {items.length === 0 ? (
        <p className="py-6 text-center text-xs text-neutral-500">
          {pickByLocale(locale, COPY.emptySection)}
        </p>
      ) : (
        <ul className="space-y-2.5">
          {items.map((item) => (
            <PlanItemRow key={item.id} item={item} locale={locale} />
          ))}
        </ul>
      )}
    </section>
  );
}

// ── Skeleton + empty + error ─────────────────────────────────────────────────

function PlanSkeleton() {
  return (
    <div className="space-y-6" aria-hidden="true" data-testid="living-plan-skeleton">
      <div className="h-32 animate-pulse rounded-2xl border border-border bg-muted/20" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-48 animate-pulse rounded-2xl border border-border bg-muted/20"
          />
        ))}
      </div>
    </div>
  );
}

function EmptyState({ locale }: { locale: Locale }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-12 text-center">
      <div
        aria-hidden
        className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-emerald-500/30 bg-emerald-500/10 text-xl text-emerald-400"
      >
        ✓
      </div>
      <p className="mx-auto max-w-md text-sm text-neutral-300">
        {pickByLocale(locale, COPY.emptyAllClear)}
      </p>
    </div>
  );
}

// ── Panel ────────────────────────────────────────────────────────────────────

export function LivingPlanPanel() {
  const locale = useLocale();
  const [data, setData] = useState<PlanData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await loadPlan());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const isEmpty = useMemo(
    () => Boolean(data && data.summary.empty),
    [data],
  );

  return (
    <div className="space-y-8">
      <header className="border-b border-border pb-6">
        <p className="text-xs uppercase tracking-wide text-neutral-400">
          {pickByLocale(locale, COPY.eyebrow)}
        </p>
        <h1 className="mt-2 font-display text-3xl text-foreground">
          {pickByLocale(locale, COPY.heading)}
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-neutral-400">
          {pickByLocale(locale, COPY.gloss)}
        </p>
      </header>

      {error ? (
        <div className="rounded-2xl border border-destructive/40 bg-destructive/5 p-6 text-center">
          <p className="text-sm font-medium text-destructive">
            {pickByLocale(locale, COPY.errorTitle)}
          </p>
          <button
            type="button"
            onClick={() => void refresh()}
            className="mt-4 rounded-lg border border-border bg-background px-4 py-2 text-sm text-foreground transition-colors hover:border-foreground/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/40"
          >
            {pickByLocale(locale, COPY.retry)}
          </button>
        </div>
      ) : loading || !data ? (
        <PlanSkeleton />
      ) : isEmpty ? (
        <EmptyState locale={locale} />
      ) : (
        <div className="space-y-6">
          <HealthMeter
            health={data.summary.health}
            nextDueAt={data.summary.nextDueAt}
            locale={locale}
          />

          {data.overdue.length > 0 ? (
            <PlanSection
              title={pickByLocale(locale, COPY.overdueSection)}
              items={data.overdue}
              locale={locale}
              accent="warning"
            />
          ) : null}

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <PlanSection
              title={pickByLocale(locale, COPY.nextActions)}
              items={data.nextActions}
              locale={locale}
            />
            <PlanSection
              title={pickByLocale(locale, COPY.waitingFor)}
              items={data.waitingFor}
              locale={locale}
            />
            <PlanSection
              title={pickByLocale(locale, COPY.ticklerUpcoming)}
              items={data.tickler}
              locale={locale}
            />
            <PlanSection
              title={pickByLocale(locale, COPY.somedaySection)}
              items={data.someday}
              locale={locale}
            />
          </div>

          {data.done.length > 0 ? (
            <PlanSection
              title={pickByLocale(locale, COPY.pastSection)}
              items={data.done}
              locale={locale}
            />
          ) : null}
        </div>
      )}
    </div>
  );
}
