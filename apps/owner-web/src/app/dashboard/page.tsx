import { getOwnerSession } from '@/lib/session';
import { OwnerDashboardSurface } from '@/components/dashboard/OwnerDashboardSurface';

/**
 * D-W-01 — Owner dashboard (structured-status secondary view).
 *
 * Pivot 2026-05-27: home (`/`) is chat-first; the dashboard is the
 * complementary structured surface. Server Component pulls the
 * authenticated session (middleware already enforces sign-in) and
 * delegates rendering to the client-side `<OwnerDashboardSurface />`.
 *
 * Seven slots laid out per `Docs/research/owner-status-sota.md` R1:
 *   - AI daily brief
 *   - Alert queue (open decisions + high-severity incidents)
 *   - KPI strip (production, cash days, safety, licence, FX)
 *   - Production-vs-target per site
 *   - Cash & USD-cliff
 *   - Compliance + safety panel
 *   - Quick actions back to the chat home (`/`).
 */
export default async function OwnerDashboardPage() {
  const session = await getOwnerSession();
  return (
    <div className="px-8 py-10">
      <header className="mb-10 border-b border-border pb-8">
        <p className="font-mono text-caption uppercase tracking-widest text-signal-500">
          Dashboard
        </p>
        <h1 className="mt-3 font-display text-4xl font-medium tracking-tight text-foreground sm:text-5xl">
          Hali ya leo, {session.salutation}
        </h1>
        <p className="mt-3 font-mono text-caption uppercase tracking-widest text-neutral-500">
          {session.tenant.legalName} · {session.tenant.region} ·{' '}
          {session.sites.length} sites · plan: {session.tenant.plan}
        </p>
      </header>
      <OwnerDashboardSurface />
    </div>
  );
}
