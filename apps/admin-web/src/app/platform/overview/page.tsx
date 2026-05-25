import Link from 'next/link';
import {
  Building2,
  CreditCard,
  Activity,
  ArrowUpRight,
  CheckCircle,
} from 'lucide-react';
import { PageShell } from '@/components/migrated/PageShell';
import { LiveDataRequiredPanel } from '@/components/migrated/LiveDataRequiredPanel';
import { KpiTiles } from './KpiTiles';

/**
 * Platform Overview — migrated from
 * apps/admin-portal/src/app/platform/overview/page.tsx.
 *
 * The legacy version rendered hardcoded mock revenue/tenant-growth
 * series via recharts. admin-web does not ship recharts as
 * a dependency, and HQ surfaces are required to render only from live
 * aggregates.
 *
 * KPI tiles fetch `/api/platform/overview` (a Next.js BFF route the
 * platform-overview aggregator will own once it ships). When the
 * endpoint 404s the tiles render em-dashes; the trend section stays as
 * `LiveDataRequiredPanel` until `/api/platform/overview/{revenue,
 * tenants}` are wired and recharts is added back.
 */

const QUICK_LINKS = [
  {
    href: '/platform/subscriptions',
    label: 'Subscriptions',
    icon: CheckCircle,
  },
  { href: '/platform/billing', label: 'Billing', icon: CreditCard },
  { href: '/feature-flags', label: 'Feature flags', icon: Activity },
  { href: '/industry', label: 'Industry dashboard', icon: Building2 },
] as const;

export default function PlatformOverviewPage() {
  return (
    <PageShell
      title="Platform overview"
      subtitle="Sector-wide KPIs across every Borjie tenant. Live numbers only — no mock data."
    >
      <div className="space-y-6">
        <KpiTiles />

        <LiveDataRequiredPanel
          feature="Revenue & tenant trend charts"
          description="Trend charts render only when /api/platform/overview/{revenue, tenants} report calibrated time-series. The legacy mocked recharts panels were removed."
        />

        <div className="platform-card">
          <h3 className="mb-4 font-display text-foreground">Quick actions</h3>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {QUICK_LINKS.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className="flex items-center gap-3 rounded-lg border border-border p-4 transition-colors hover:border-signal-500/40 hover:bg-surface"
              >
                <Icon className="h-5 w-5 text-signal-500" />
                <span className="text-sm font-medium text-foreground">
                  {label}
                </span>
                <ArrowUpRight className="ml-auto h-4 w-4 text-neutral-500" />
              </Link>
            ))}
          </div>
        </div>
      </div>
    </PageShell>
  );
}
