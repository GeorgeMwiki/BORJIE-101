import { Suspense } from 'react';
import { StaffNav } from '@/components/StaffNav';
import { StaffIdentityStrip } from '@/components/StaffIdentityStrip';
import { QueryProvider } from '@/components/internal/QueryProvider';
import { AdminDashboardSurface } from '@/components/dashboard/AdminDashboardSurface';

/**
 * D-A-01 — Admin dashboard (structured-status secondary view).
 *
 * Pivot 2026-05-27: HQ home (`/`) is the chat-first surface; this
 * dashboard is the complementary read-only status view. Server
 * Component pulls the staff nav + identity strip (middleware already
 * enforces sign-in via Supabase session) and delegates panel rendering
 * to the `<AdminDashboardSurface />` client island.
 *
 * Panels:
 *   - Tenants overview        (total + recent five)
 *   - Pilot errors (recent)   (Sentry-shaped ring buffer)
 *   - Kill-switch status
 *   - Corpus ingest queue
 *   - Feature-flag rollouts
 *   - Audit chain integrity   (rolling 24h)
 */
export default function AdminDashboardPage() {
  return (
    <div className="flex min-h-screen">
      <StaffNav />
      <main className="flex-1 p-10" id="main-content">
        <header className="mb-8 flex items-start justify-between">
          <div>
            <p className="text-caption uppercase tracking-widest text-signal-500">
              Dashboard
            </p>
            <h1 className="mt-1 text-4xl font-display text-foreground">
              Platform status
            </h1>
            <p className="mt-2 max-w-xl text-sm text-neutral-400">
              Read-only structured view across every Borjie tenant. Tenants,
              pilot errors, kill-switch, corpus, feature flags, audit chain
              integrity. For investigation hop into chat at{' '}
              <a className="text-signal-500 underline" href="/">
                HQ
              </a>
              .
            </p>
          </div>
          <StaffIdentityStrip />
        </header>
        <QueryProvider>
          <Suspense fallback={<DashboardFallback />}>
            <AdminDashboardSurface />
          </Suspense>
        </QueryProvider>
      </main>
    </div>
  );
}

function DashboardFallback() {
  return (
    <div
      className="grid grid-cols-1 gap-4 lg:grid-cols-3"
      data-testid="admin-dashboard-fallback"
    >
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="h-44 animate-pulse rounded-lg border border-border bg-surface/40"
        />
      ))}
    </div>
  );
}
