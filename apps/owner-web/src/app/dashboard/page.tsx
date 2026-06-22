import { Suspense } from 'react';
import Link from 'next/link';
import { ArrowRight, Brain, Sparkles } from 'lucide-react';
import { getOwnerSession } from '@/lib/session';
import { getServerT } from '@/i18n/t.server';
import { readLocaleFromServerCookies } from '@/lib/locale.server';
import { OwnerDashboardSurface } from '@/components/dashboard/OwnerDashboardSurface';
import { DashboardBriefSummary } from '@/components/dashboard/DashboardBriefSummary';
import { DailyBriefCard } from '@/components/dashboard/DailyBriefCard';
import { OwnerOSShell } from '@/components/owner-os/OwnerOSShell';

/**
 * D-W-01 — Owner dashboard.
 *
 * SOTA lazy-load Wave 1 — the page no longer `await`s the session at the
 * top (which previously blocked the WHOLE page on a Supabase round-trip).
 * Instead the static chrome — the CTA link strip that needs no session —
 * paints immediately, and each independently-dynamic concern streams
 * inside its OWN <Suspense> boundary:
 *
 *   - <GreetingHero>          → session-derived headline + subline
 *   - <DailyBriefCard>        → already a client island (own fetch)
 *   - <DashboardBriefSummary> → client island, own react-query hook
 *   - <OwnerOSRegion>         → Owner-OS shell (needs session)
 *   - <OwnerDashboardSurface> → live BFF surface (own fetch)
 *
 * `getOwnerSession()` is React-`cache()`d, so the two server regions that
 * read it share one network resolution — no duplicate auth calls. Every
 * region resolves the SAME correct content as before; only WHEN each
 * paints changed (streamed behind a layout-stable skeleton, never a fake
 * empty result).
 */
export default function OwnerDashboardPage() {
  return (
    <div className="space-y-10">
      {/* 1. Greeting hero — session-derived copy streams behind a
              header-shaped skeleton; the static CTA strip is part of the
              hero region so the whole header lands as one coherent unit. */}
      <Suspense fallback={<GreetingHeroSkeleton />}>
        <GreetingHero />
      </Suspense>

      {/* 1b. Mr. Mwikila's daily brief — independent client island that
              fetches today's snapshot. Streams on its own. */}
      <Suspense fallback={<BlockSkeleton heightClass="h-44" />}>
        <DailyBriefSection />
      </Suspense>

      {/* 2-5. Real-data summary — metric tiles, today's actions, this
              week and the brain stream, all sourced from the live
              `/api/v1/owner/brief` BFF via its own client hook. */}
      <Suspense fallback={<BriefSummarySkeleton />}>
        <BriefSummaryRegion />
      </Suspense>

      {/* Owner operating system shell — needs session; streams in its
          own boundary so a slow auth/profile read never holds the rest
          of the dashboard hostage. */}
      <Suspense fallback={<OwnerOsSkeleton />}>
        <OwnerOSRegion />
      </Suspense>

      {/* 6. Live BFF surface — own fetch, own boundary. */}
      <section aria-labelledby="live-surface-heading" className="space-y-3">
        <Suspense fallback={<LiveSurfaceSkeleton />}>
          <LiveSurfaceRegion />
        </Suspense>
      </section>
    </div>
  );
}

/**
 * Session-derived greeting hero. Isolated in its own async server
 * component so the page shell never blocks on the session read — only
 * this region suspends.
 */
async function GreetingHero() {
  const session = await getOwnerSession();
  const t = await getServerT();

  const greeting = t('dashboard.greeting', { name: session.salutation });
  const subline = t('dashboard.subline', {
    legalName: session.tenant.legalName ?? 'Borjie',
    region: session.tenant.region ?? '',
    sites: session.sites.length,
    plan: session.tenant.plan ?? '',
  });

  return (
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
  );
}

/**
 * Daily-brief section — keeps the labelled <section> wrapper and feeds
 * the already-client `DailyBriefCard` island its session-derived props.
 */
async function DailyBriefSection() {
  const session = await getOwnerSession();
  const t = await getServerT();
  const isSw = session.languagePreference === 'sw';
  return (
    <section
      aria-labelledby="daily-brief-heading"
      data-testid="dashboard-daily-brief-section"
    >
      <h2 id="daily-brief-heading" className="sr-only">
        {t('dashboard.briefSrHeading')}
      </h2>
      <DailyBriefCard isSw={isSw} salutation={session.salutation} />
    </section>
  );
}

/**
 * Brief-summary region — resolves the borjie_locale cookie ONCE on the server
 * and seeds the client island so its first paint matches the SSR `<html lang>`
 * (no EN-under-SW split-brain on the metric tiles / today's actions).
 */
async function BriefSummaryRegion() {
  const initialLocale = await readLocaleFromServerCookies();
  return <DashboardBriefSummary initialLocale={initialLocale} />;
}

/**
 * Owner-OS region — session-derived props for the shell.
 */
async function OwnerOSRegion() {
  const session = await getOwnerSession();
  const t = await getServerT();
  return (
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
  );
}

/**
 * Live BFF surface region — the heading needs the translator; the
 * surface owns its own fetch.
 */
async function LiveSurfaceRegion() {
  const t = await getServerT();
  // Resolve the borjie_locale cookie ONCE on the server and seed the client
  // islands inside OwnerDashboardSurface so their first paint matches the
  // SSR `<html lang>` language (no EN-under-SW split-brain).
  const initialLocale = await readLocaleFromServerCookies();
  return (
    <>
      <h2
        id="live-surface-heading"
        className="text-badge font-semibold uppercase tracking-eyebrow-wide text-neutral-400"
      >
        {t('dashboard.liveBrief')}
      </h2>
      <OwnerDashboardSurface initialLocale={initialLocale} />
    </>
  );
}

// ── Layout-stable fallbacks (zero CLS) ──────────────────────────────

function GreetingHeroSkeleton() {
  return (
    <header aria-hidden="true">
      <div className="h-3 w-32 animate-pulse rounded-full bg-muted/40" />
      <div className="mt-4 h-12 w-3/4 animate-pulse rounded-lg bg-muted/40" />
      <div className="mt-3 h-3 w-1/2 animate-pulse rounded-full bg-muted/30" />
      <div className="mt-6 flex flex-wrap gap-3">
        <div className="h-9 w-32 animate-pulse rounded-full bg-muted/30" />
        <div className="h-9 w-32 animate-pulse rounded-full bg-muted/20" />
        <div className="h-9 w-36 animate-pulse rounded-full bg-muted/20" />
      </div>
    </header>
  );
}

function BlockSkeleton({ heightClass }: { readonly heightClass: string }) {
  return (
    <div
      className={`${heightClass} animate-pulse rounded-xl border border-border bg-muted/30`}
      aria-hidden="true"
    />
  );
}

function BriefSummarySkeleton() {
  return (
    <div
      className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5"
      aria-hidden="true"
    >
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          className="h-32 animate-pulse rounded-xl border border-border bg-muted/30"
        />
      ))}
    </div>
  );
}

function OwnerOsSkeleton() {
  return (
    <div className="space-y-3" aria-hidden="true">
      <div className="h-3 w-28 animate-pulse rounded-full bg-muted/30" />
      <div className="h-48 animate-pulse rounded-xl border border-border bg-muted/20" />
    </div>
  );
}

function LiveSurfaceSkeleton() {
  return (
    <div aria-hidden="true">
      <div className="h-3 w-28 animate-pulse rounded-full bg-muted/30" />
      <div className="mt-3 h-64 animate-pulse rounded-xl border border-border bg-muted/20" />
    </div>
  );
}
