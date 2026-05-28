import { QueryProvider } from '@/components/internal/QueryProvider';
import { TenantDirectory } from '@/components/internal/tenants/TenantDirectory';

/**
 * Tenant directory — dense data table at the top-level admin URL.
 *
 * Mirrors LitFin's `/litfin-admin/banks` page composition: page header
 * with eyebrow + action affordance, then the dense filterable +
 * paginated TenantDirectory component (sticky header, plan + status
 * filter chips, row click opens detail). The component is shared with
 * `/internal/tenants` — this route is the LitFin-parity entry point.
 */
export default function TenantsPage(): JSX.Element {
  return (
    <QueryProvider>
      <div className="space-y-6">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-6">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-widest text-signal-500">
              Tenants · Wapangaji
            </p>
            <h1 className="mt-3 font-display text-3xl font-medium tracking-tight text-foreground sm:text-4xl">
              Tenant directory
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-neutral-400">
              Every Borjie tenant — plan, status, ARR, last-active. Row click
              opens the tenant detail drawer. Filter by plan or status; search
              by name or primary commodity.
            </p>
          </div>
          <button
            type="button"
            disabled
            title="Provisioning form lands with self-serve tenant onboarding"
            className="rounded-md bg-signal-500/40 px-3 py-1.5 text-xs font-medium text-primary-foreground opacity-50 cursor-not-allowed"
          >
            New tenant
          </button>
        </header>

        <TenantDirectory />
      </div>
    </QueryProvider>
  );
}
