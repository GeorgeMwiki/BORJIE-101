import Link from 'next/link';
import {
  ArrowRight,
  Brain,
  Calculator,
  FileCheck,
  HardHat,
  Sparkles,
  TrendingUp,
  Users,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { getOwnerSession } from '@/lib/session';
import { OwnerDashboardSurface } from '@/components/dashboard/OwnerDashboardSurface';
import { DailyBriefCard } from '@/components/dashboard/DailyBriefCard';
import { OwnerOSShell } from '@/components/owner-os/OwnerOSShell';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/Card';

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
 * The data on the strip / actions / week panels is the spec's
 * placeholder copy (deliberately static for the shell-mirror pass);
 * the live surface below is unchanged and continues to call the BFF.
 */
export default async function OwnerDashboardPage() {
  const session = await getOwnerSession();
  const isSw = session.languagePreference === 'sw';

  const greeting = isSw
    ? `Welcome back, ${session.salutation}`
    : `Welcome back, ${session.salutation}`;

  const subline = isSw
    ? `${session.tenant.legalName} - ${session.tenant.region} - migodi ${session.sites.length}, mpango: ${session.tenant.plan}`
    : `${session.tenant.legalName} - ${session.tenant.region} - ${session.sites.length} sites, plan: ${session.tenant.plan}`;

  return (
    <div className="space-y-10">
      {/* 0. Mr. Mwikila daily brief card (top of dashboard) */}
      <DailyBriefCard isSw={isSw} salutation={session.salutation} />

      {/* 1. Greeting hero */}
      <header>
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-signal-500">
          {isSw ? 'Dashibodi ya leo' : "Today's cockpit"}
        </p>
        <h1 className="mt-3 font-display text-4xl font-medium tracking-tight text-foreground sm:text-5xl">
          {greeting}
        </h1>
        <p className="mt-3 font-mono text-[11px] uppercase tracking-[0.18em] text-neutral-500">
          {subline}
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            href="/ask"
            className="inline-flex items-center gap-2 rounded-full bg-signal-500 px-5 py-2 text-sm font-semibold text-background hover:bg-signal-400"
          >
            <Sparkles className="h-4 w-4" />
            {isSw ? 'Uliza Borjie' : 'Ask Borjie'}
            <ArrowRight className="h-4 w-4" />
          </Link>
          <Link
            href="/cockpit"
            className="inline-flex items-center gap-2 rounded-full border border-border px-5 py-2 text-sm font-semibold text-foreground hover:bg-surface"
          >
            {isSw ? 'Mkurugenzi' : 'Cockpit view'}
          </Link>
          <Link
            href="/master-brain"
            className="inline-flex items-center gap-2 rounded-full border border-border px-5 py-2 text-sm font-semibold text-foreground hover:bg-surface"
          >
            <Brain className="h-4 w-4" />
            {isSw ? 'Akili Kuu' : 'Master Brain'}
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
          {isSw ? 'Muhtasari wa Mr. Mwikila' : "Mr. Mwikila's daily brief"}
        </h2>
        <DailyBriefCard
          isSw={isSw}
          salutation={session.salutation}
        />
      </section>

      {/* 2. Today's brief - 3 metric tiles */}
      <section aria-labelledby="todays-brief-heading">
        <h2
          id="todays-brief-heading"
          className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-400"
        >
          {isSw ? 'Muhtasari wa leo' : "Today's brief"}
        </h2>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <MetricTile
            label={isSw ? 'Leseni hai' : 'Open licences'}
            value={`${session.sites.length}`}
            sub={isSw ? 'PML / PL chini ya kampuni' : 'Active PML / PL holdings'}
            icon={FileCheck}
          />
          <MetricTile
            label={isSw ? 'Rasimu ya mrabaha' : 'Royalty draft status'}
            value={isSw ? 'Inakaguliwa' : 'In review'}
            sub={
              isSw
                ? 'Inajiandaa kwa makato ya mwezi'
                : 'Drafting for the month cut-off'
            }
            icon={Calculator}
          />
          <MetricTile
            label={isSw ? 'Wafanyakazi zamu' : 'Workforce on shift'}
            value="48"
            sub={isSw ? 'Zamu ya asubuhi - migodi 3' : 'Morning shift - 3 sites'}
            icon={Users}
          />
        </div>
      </section>

      {/* 3. Today's actions - 2-col priority cards */}
      <section aria-labelledby="todays-actions-heading">
        <h2
          id="todays-actions-heading"
          className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-400"
        >
          {isSw ? 'Hatua za leo' : "Today's actions"}
        </h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <ActionCard
            title={
              isSw
                ? 'Saini taarifa ya uzalishaji'
                : 'Sign daily production report'
            }
            context={
              isSw
                ? 'Mkuu wa mgodi amewasilisha ratiba ya leo'
                : 'Site manager submitted the daily roll-up'
            }
            ctaLabel={isSw ? 'Fungua' : 'Open'}
            ctaHref="/site-cockpit"
          />
          <ActionCard
            title={isSw ? 'Kagua malipo ya wafanyakazi' : 'Approve workforce advances'}
            context={
              isSw
                ? 'Maombi 3 ya juu ya limit ya kawaida'
                : '3 requests above the standard limit'
            }
            ctaLabel={isSw ? 'Kagua' : 'Review'}
            ctaHref="/people"
          />
          <ActionCard
            title={
              isSw ? 'Idhinisha mauzo ya dhahabu' : 'Confirm gold sale offer'
            }
            context={
              isSw
                ? 'Wanunuzi 2 wamewasilisha bei ya leo'
                : '2 buyers have submitted prices for today'
            }
            ctaLabel={isSw ? 'Linganisha' : 'Compare'}
            ctaHref="/marketplace"
          />
          <ActionCard
            title={isSw ? 'Saini fomu ya NEMC' : 'Sign NEMC submission'}
            context={
              isSw
                ? 'Pakiti ya kila mwezi inahitaji sahihi yako'
                : 'Monthly packet is pending your signature'
            }
            ctaLabel={isSw ? 'Saini' : 'Sign'}
            ctaHref="/compliance"
          />
        </div>
      </section>

      {/* 4. This week - 3-col upcoming events */}
      <section aria-labelledby="this-week-heading">
        <h2
          id="this-week-heading"
          className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-400"
        >
          {isSw ? 'Wiki hii' : 'This week'}
        </h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <EventCard
            title={isSw ? 'Mwisho wa leseni' : 'Licence expiry'}
            when={isSw ? 'Ijumaa - siku 4' : 'Friday - 4 days'}
            href="/licences"
            tone="warning"
          />
          <EventCard
            title={isSw ? 'Makato ya mrabaha' : 'Royalty cut-off'}
            when={isSw ? 'Jumatatu - siku 7' : 'Monday - 7 days'}
            href="/finance"
            tone="signal"
          />
          <EventCard
            title={isSw ? 'Ukaguzi wa NEMC' : 'NEMC review'}
            when={isSw ? 'Alhamisi - siku 10' : 'Thursday - 10 days'}
            href="/compliance"
            tone="neutral"
          />
        </div>
      </section>

      {/* 5. Brain stream - recent Master Brain decisions */}
      <section aria-labelledby="brain-stream-heading" className="space-y-3">
        <header className="flex items-center justify-between">
          <h2
            id="brain-stream-heading"
            className="text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-400"
          >
            {isSw ? 'Mtiririko wa Akili Kuu' : 'Brain stream'}
          </h2>
          <Link
            href="/master-brain"
            className="inline-flex items-center gap-1 text-xs font-semibold text-signal-500 hover:underline"
          >
            {isSw ? 'Onyesha zote' : 'View all'}
            <ArrowRight className="h-3 w-3" />
          </Link>
        </header>
        <Card variant="outline" className="border-border/60 bg-surface/40">
          <CardHeader bordered>
            <CardTitle size="sm">
              {isSw
                ? 'Master Brain - maamuzi ya hivi karibuni'
                : 'Master Brain - recent decisions'}
            </CardTitle>
            <CardDescription>
              {isSw
                ? 'Maamuzi ya juu yenye uthibitisho wa LMBM na mlolongo wa sababu.'
                : 'Top decisions with LMBM evidence and rationale.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 pt-4">
            <BrainStreamRow
              tone="signal"
              title={
                isSw
                  ? 'Pendekeza kuhifadhi gramu 400 hadi Ijumaa'
                  : 'Recommend holding 400g until Friday'
              }
              detail={
                isSw
                  ? 'Bei ya dhahabu inaonyesha mwelekeo wa juu wa 1.2%'
                  : 'Gold price trending up 1.2% on the LBMA close'
              }
            />
            <BrainStreamRow
              tone="warning"
              title={
                isSw
                  ? 'Onyo: dormancy ya leseni PML/247'
                  : 'Warning: dormancy on PML/247'
              }
              detail={
                isSw
                  ? 'Hakuna shughuli ya wiki 4 - kuruhusu kupoteza kwa siku 28'
                  : '4-week gap - 28-day forfeiture risk window'
              }
            />
            <BrainStreamRow
              tone="success"
              title={
                isSw
                  ? 'Akili Kuu imeidhinisha pakiti ya NEMC'
                  : 'Master Brain approved NEMC packet draft'
              }
              detail={
                isSw
                  ? 'Vidokezo 14 vya uthibitisho vimepatikana'
                  : '14 citations attached from intelligence corpus'
              }
            />
          </CardContent>
        </Card>
      </section>

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
          className="text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-400"
        >
          {isSw ? 'Mr. Mwikila — mfumo wako' : 'Mr. Mwikila — your operating system'}
        </h2>
        <OwnerOSShell
          salutation={session.salutation}
          tradingName={session.tenant.legalName ?? 'Borjie'}
          languagePreference={session.languagePreference}
        />
      </section>

      {/* 6. Live BFF surface */}
      <section aria-labelledby="live-surface-heading" className="space-y-3">
        <h2
          id="live-surface-heading"
          className="text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-400"
        >
          {isSw ? 'Mtiririko wa moja kwa moja' : 'Live brief'}
        </h2>
        <OwnerDashboardSurface />
      </section>
    </div>
  );
}

// ------------------------------------------------------------------
// Local primitives — small, self-contained, no cross-page leak.
// ------------------------------------------------------------------

interface MetricTileProps {
  readonly label: string;
  readonly value: string;
  readonly sub: string;
  readonly icon: LucideIcon;
}

function MetricTile({ label, value, sub, icon: Icon }: MetricTileProps) {
  return (
    <Card variant="default" className="border-border/60">
      <CardContent className="flex items-start justify-between p-6">
        <div className="space-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-400">
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

function ActionCard({ title, context, ctaLabel, ctaHref }: ActionCardProps) {
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
  readonly href: string;
  readonly tone: 'signal' | 'warning' | 'neutral';
}

function EventCard({ title, when, href, tone }: EventCardProps) {
  const toneRing =
    tone === 'signal'
      ? 'before:bg-signal-500'
      : tone === 'warning'
        ? 'before:bg-warning'
        : 'before:bg-neutral-500';
  const Icon = tone === 'warning' ? HardHat : tone === 'signal' ? TrendingUp : FileCheck;
  return (
    <Link
      href={href}
      className={`group relative block overflow-hidden rounded-lg border border-border/60 bg-surface/60 p-5 hover:bg-surface ${toneRing} before:absolute before:left-0 before:top-0 before:h-full before:w-[3px]`}
    >
      <div className="flex items-center gap-2 text-xs text-neutral-400">
        <Icon className="h-3.5 w-3.5" />
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
  readonly tone: 'signal' | 'warning' | 'success';
  readonly title: string;
  readonly detail: string;
}

function BrainStreamRow({ tone, title, detail }: BrainStreamRowProps) {
  const dot =
    tone === 'signal'
      ? 'bg-signal-500'
      : tone === 'warning'
        ? 'bg-warning'
        : 'bg-success';
  return (
    <div className="flex items-start gap-3">
      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${dot}`} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-foreground">{title}</div>
        <div className="truncate text-xs text-neutral-400">{detail}</div>
      </div>
    </div>
  );
}
