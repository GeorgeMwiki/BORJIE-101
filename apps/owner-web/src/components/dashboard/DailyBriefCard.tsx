'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { Sparkles, Play, ArrowRight, Coins, ShieldAlert, TrendingUp } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useOwnerDailyBrief } from '@/lib/queries/owner-brief';

/**
 * Daily brief card — top-of-dashboard hero. Surfaces the brain-composed
 * Mr. Mwikila greeting (advisor slice) + 3-sentence summary + 3 quick
 * action chips + Listen CTA.
 *
 * Wave: OWNER-OS DAILY-BRIEF rebuild (scope #105 follow-up).
 *
 * Renders nothing while loading or empty; the dashboard layout's
 * existing greeting hero remains the persistent baseline so the card
 * is purely additive — never replaces critical content.
 */
export function DailyBriefCard({
  isSw,
  salutation,
}: {
  readonly isSw: boolean;
  readonly salutation: string;
}): JSX.Element | null {
  const { data, isLoading, isError } = useOwnerDailyBrief();

  const greeting = useMemo(() => composeTimeAwareGreeting(isSw, salutation), [
    isSw,
    salutation,
  ]);

  if (isLoading || isError) {
    return null;
  }
  const brief = data?.brief ?? null;
  if (!brief) {
    return null;
  }

  const advisor = brief.advisor ?? null;
  const summarySentences = composeSummarySentences(brief, isSw);

  return (
    <section
      className="rounded-3xl border border-border bg-surface/80 p-8 shadow-sm"
      data-testid="dashboard-daily-brief-card"
      aria-label={isSw ? 'Muhtasari wa siku' : "Today's daily brief"}
    >
      <header className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <span className="grid h-12 w-12 place-items-center rounded-full bg-signal-500/15 text-signal-500">
            <Sparkles className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-signal-500">
              {isSw ? 'Bw. Mwikila' : 'Mr. Mwikila'} ·{' '}
              {isSw ? 'Mkurugenzi Mtendaji wa AI' : 'AI Managing Director'}
            </p>
            <h2 className="mt-1 font-display text-2xl font-medium tracking-tight text-foreground">
              {greeting}
            </h2>
          </div>
        </div>
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-xs font-semibold text-foreground hover:bg-surface"
          data-testid="dashboard-daily-brief-listen"
          aria-label={isSw ? 'Sikia muhtasari' : 'Listen to brief'}
        >
          <Play className="h-3.5 w-3.5" aria-hidden />
          {isSw ? 'Sikia' : 'Listen'}
        </button>
      </header>

      <div className="mt-6 space-y-2.5">
        {summarySentences.map((sentence, idx) => (
          <p
            key={`sum-${idx}`}
            className="text-sm leading-relaxed text-neutral-200"
          >
            {sentence}
          </p>
        ))}
        {advisor ? (
          <p className="rounded-xl border border-signal-500/30 bg-signal-500/5 p-3 text-sm leading-relaxed text-signal-100">
            <span className="font-semibold text-signal-300">
              {isSw ? 'Hatua: ' : 'Action: '}
            </span>
            {advisor.action}
          </p>
        ) : null}
      </div>

      <nav className="mt-6 flex flex-wrap gap-2">
        <QuickChip
          href="/cockpit"
          icon={TrendingUp}
          label={isSw ? 'Uzalishaji' : 'Production'}
        />
        <QuickChip
          href="/treasury"
          icon={Coins}
          label={isSw ? 'Hazina' : 'Treasury'}
        />
        <QuickChip
          href="/compliance"
          icon={ShieldAlert}
          label={isSw ? 'Utii' : 'Compliance'}
        />
      </nav>
    </section>
  );
}

function QuickChip({
  href,
  icon: Icon,
  label,
}: {
  readonly href: string;
  readonly icon: LucideIcon;
  readonly label: string;
}): JSX.Element {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-3.5 py-1.5 text-xs font-semibold text-foreground hover:border-signal-500 hover:text-signal-500"
    >
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {label}
      <ArrowRight className="h-3 w-3" aria-hidden />
    </Link>
  );
}

function composeTimeAwareGreeting(isSw: boolean, salutation: string): string {
  const hour = new Date().getHours();
  if (isSw) {
    if (hour < 12) return `Habari za asubuhi, ${salutation}.`;
    if (hour < 17) return `Habari za mchana, ${salutation}.`;
    return `Habari za jioni, ${salutation}.`;
  }
  if (hour < 12) return `Good morning, ${salutation}.`;
  if (hour < 17) return `Good afternoon, ${salutation}.`;
  return `Good evening, ${salutation}.`;
}

function composeSummarySentences(
  brief: NonNullable<ReturnType<typeof useOwnerDailyBrief>['data']>['brief'],
  isSw: boolean,
): ReadonlyArray<string> {
  if (!brief) return [];
  if (brief.advisor?.insight) {
    return [brief.advisor.insight];
  }
  // Deterministic fallback — never invent numbers.
  const shifts = brief.dailyBrief.shiftsToday;
  const incidents = brief.openHighIncidents.count;
  const pending = brief.decisions.pendingCount;
  return isSw
    ? [
        `Zamu ${shifts} zimeingia leo, matukio makubwa ${incidents} bado yapo wazi.`,
        `Maamuzi ${pending} yanasubiri uamuzi wako.`,
      ]
    : [
        `${shifts} shifts logged today; ${incidents} high incidents still open.`,
        `${pending} decisions are waiting on you.`,
      ];
}
