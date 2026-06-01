import Link from 'next/link';
import { ArrowRight, Brain, Sparkles } from 'lucide-react';
import { getOwnerSession } from '@/lib/session';
import { getServerT } from '@/i18n/t.server';
// NOTE: `isSw` is still derived below purely to drive the DailyBriefCard
// child, which owns its own (separately-migrated) copy; the page's own
// chrome now resolves through t().
import { OwnerDashboardSurface } from '@/components/dashboard/OwnerDashboardSurface';
import { DashboardBriefSummary } from '@/components/dashboard/DashboardBriefSummary';
import { DailyBriefCard } from '@/components/dashboard/DailyBriefCard';
import { OwnerOSShell } from '@/components/owner-os/OwnerOSShell';

/**
 * D-W-01 — Owner dashboard.
 *
 * Composition mirrors LitFin's `(borrower)/borrower/dashboard/page.tsx`:
 *   1. Greeting hero (eyebrow + headline + subline + CTA strip).
 *   2. Today's brief — 3-tile metric strip in a `lg:grid-cols-3` row.
 *   3. Today's actions — 2-col card grid of priority items, each with
 *      a one-line context and a CTA button (mirrors LitFin's "priority
 *      actions" composition).
 *   4. This week — 3-col grid of upcoming events (licence expiry,
 *      royalty cut-off, NEMC review).
 *   5. Brain stream — a small panel of recent Master Brain decisions
 *      followed by the live `<OwnerDashboardSurface />` (seven slots
 *      sourced from `/api/v1/owner/brief`).
 *
 * Sections 2-5 are now driven by REAL `/api/v1/owner/brief` data via the
 * `<DashboardBriefSummary />` client island — each block degrades to an
 * explicit empty state instead of the former fabricated placeholder copy
 * (no invented royalty advice, no fake workforce count). The live surface
 * below is unchanged and continues to call the BFF.
 */
export default async function OwnerDashboardPage() {
  const session = await getOwnerSession();
  const t = await getServerT();
  const isSw = session.languagePreference === 'sw';

  const greeting = t('dashboard.greeting', { name: session.salutation });

  const subline = t('dashboard.subline', {
    legalName: session.tenant.legalName ?? 'Borjie',
    region: session.tenant.region ?? '',
    sites: session.sites.length,
    plan: session.tenant.plan ?? '',
  });

  return (
    <div className="space-y-10">
      {/* 1. Greeting hero */}
      <header>
        <p className="font-mono text-badge uppercase tracking-eyebrow-wide text-signal-500">
          {t('dashboard.eyebrow')}
        </p>
        <h1 className="mt-3 font-display text-4xl font-medium tracking-tight text-foreground sm:text-5xl">
          {greeting}
        </h1>
        <p className="mt-3 font-mono text-badge uppercase tracking-eyebrow-wide text-neutral-500">
          {subline}
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            href="/ask"
            className="inline-flex items-center gap-2 rounded-full bg-signal-500 px-5 py-2 text-sm font-semibold text-background hover:bg-signal-400"
          >
            <Sparkles className="h-4 w-4" />
            {t('dashboard.ctaAsk')}
            <ArrowRight className="h-4 w-4" />
          </Link>
          <Link
            href="/cockpit"
            className="inline-flex items-center gap-2 rounded-full border border-border px-5 py-2 text-sm font-semibold text-foreground hover:bg-surface"
          >
            {t('dashboard.ctaCockpit')}
          </Link>
          <Link
            href="/master-brain"
            className="inline-flex items-center gap-2 rounded-full border border-border px-5 py-2 text-sm font-semibold text-foreground hover:bg-surface"
          >
            <Brain className="h-4 w-4" />
            {t('dashboard.ctaMasterBrain')}
          </Link>
        </div>
      </header>

      {/* 1b. Mr. Mwikila's daily brief - sits ABOVE the metric strip per
              Wave OWNER-OS DAILY-BRIEF rebuild. The card fetches today's
              snapshot from /api/v1/owner/daily-brief and renders the
              brain-composed warm greeting + 3-sentence summary +
              quick-action chips. */}
      <section
        aria-labelledby="daily-brief-heading"
        data-testid="dashboard-daily-brief-section"
      >
        <h2 id="daily-brief-heading" className="sr-only">
          {t('dashboard.briefSrHeading')}
        </h2>
        <DailyBriefCard
          isSw={isSw}
          salutation={session.salutation}
        />
      </section>

      {/* 2-5. Real-data summary — metric tiles, today's actions, this
              week and the brain stream all sourced from the live
              `/api/v1/owner/brief` BFF. Each block degrades to an
              explicit empty state; no fabricated figures remain. */}
      <DashboardBriefSummary />

      {/* Wave OWNER-OS — owner operating system shell. Tab strip with
          live chat (drop-zone), Docs, Drafts, Reminders, Insights.
          Sits BETWEEN the cards above and the static brief below so the
          owner can drop a file or check a reminder without scrolling. */}
      <section
        aria-labelledby="owner-os-heading"
        className="space-y-3"
        data-testid="owner-os-section"
      >
        <h2
          id="owner-os-heading"
          className="text-badge font-semibold uppercase tracking-eyebrow-wide text-neutral-400"
        >
          {t('dashboard.ownerOsHeading')}
        </h2>
        <OwnerOSShell
          salutation={session.salutation}
          tradingName={session.tenant.legalName ?? 'Borjie'}
          languagePreference={session.languagePreference}
          tenantId={session.tenant.id}
          userId={session.userId}
          role={session.role}
        />
      </section>

      {/* 6. Live BFF surface */}
      <section aria-labelledby="live-surface-heading" className="space-y-3">
        <h2
          id="live-surface-heading"
          className="text-badge font-semibold uppercase tracking-eyebrow-wide text-neutral-400"
        >
          {t('dashboard.liveBrief')}
        </h2>
        <OwnerDashboardSurface />
      </section>
    </div>
  );
}
