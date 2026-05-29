import { QueryProvider } from '@/components/internal/QueryProvider';
import { TenantJurisdictionPanel } from './TenantJurisdictionPanel';

/**
 * /tenants/:id/jurisdiction — JC-8 Borjie internal-admin jurisdiction
 * override surface.
 *
 * Renders:
 *   - Current jurisdiction snapshot (country code + locked-at + locked-by)
 *   - Propose change form (target country dropdown + reason + verifiedWith)
 *   - Pending proposals + four-eye approval queue
 *   - Decision history (approved + rejected)
 *
 * This is the human-facing counterpart to the JC-7
 * `/api/v1/admin/tenants/:id/jurisdiction` route. Tenants CANNOT
 * self-change their jurisdiction — only Borjie internal admin can,
 * and only via the four-eye flow surfaced here.
 *
 * EN-only (admin-only surface per the brief). Tenant-facing copy is
 * bilingual sw/en in the brain disclosure prompt + cockpit pulse.
 */
export default function TenantJurisdictionPage({
  params,
}: {
  readonly params: { readonly id: string };
}): JSX.Element {
  return (
    <QueryProvider>
      <div className="space-y-6">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-6">
          <div>
            <p className="font-mono text-tiny uppercase tracking-widest text-signal-500">
              Tenant · Jurisdiction
            </p>
            <h1 className="mt-3 font-display text-3xl font-medium tracking-tight text-foreground sm:text-4xl">
              Jurisdiction override
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-neutral-400">
              Tenants are LOCKED to their signup jurisdiction. Only Borjie
              internal admin can re-assign — and the change requires a
              second admin&apos;s approval (four-eye, per CLAUDE.md inviolable).
              Every step is audit-chained.
            </p>
          </div>
        </header>

        <TenantJurisdictionPanel tenantId={params.id} />
      </div>
    </QueryProvider>
  );
}
