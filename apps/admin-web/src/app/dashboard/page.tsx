import { Suspense } from 'react';
import { QueryProvider } from '@/components/internal/QueryProvider';
import { AdminDashboardSurface } from '@/components/dashboard/AdminDashboardSurface';
import { DashboardMetricStrip } from '@/components/dashboard/DashboardMetricStrip';

/**
 * D-A-01 — Admin cockpit (read-only platform status).
 *
 * Mirrors LitFin's officer dashboard composition:
 *   1. Eyebrow + hero title
 *   2. Metric strip (4 KPI cards) — tenants, sessions, latency, errors
 *   3. Two-column intelligence panels (audit, cases) plus six legacy
 *      AdminDashboardSurface panels (tenants / errors / killswitch /
 *      corpus / flags / audit chain)
 *
 * The root AdminShell already injects sidebar + top bar; this page is
 * pure content. AdminDashboardSurface is left intact — its six panels
 * each own their own react-query hook so an outage in one stays
 * scoped.
 */
export default function AdminDashboardPage() {
  return (
    <div className="space-y-8" data-testid="admin-cockpit">
      <header className="border-b border-border pb-6">
        <p className="font-mono text-[10px] uppercase tracking-widest text-signal-500">
          Cockpit · Dashibodi
        </p>
        <h1 className="mt-3 font-display text-3xl font-medium tracking-tight text-foreground sm:text-4xl">
          Platform status
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-neutral-400">
          Read-only structured view across every Borjie tenant. For
          investigation drop into chat at{' '}
          <a
            className="font-medium text-signal-500 underline-offset-4 hover:underline"
            href="/"
          >
            HQ
          </a>
          .
        </p>
      </header>

      <QueryProvider>
        <Suspense fallback={<MetricStripFallback />}>
          <DashboardMetricStrip />
        </Suspense>

        <Suspense fallback={<DashboardFallback />}>
          <AdminDashboardSurface />
        </Suspense>
      </QueryProvider>
    </div>
  );
}

function MetricStripFallback() {
  return (
    <div
      className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
      data-testid="admin-metric-strip-fallback"
    >
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="h-28 animate-pulse rounded-lg border border-border bg-surface/40"
        />
      ))}
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
