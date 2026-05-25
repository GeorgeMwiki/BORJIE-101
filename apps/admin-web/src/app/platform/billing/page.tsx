import { PageShell } from '@/components/migrated/PageShell';
import { LiveDataRequiredPanel } from '@/components/migrated/LiveDataRequiredPanel';

/**
 * Platform billing surface — migrated stub from
 * apps/admin-portal/src/app/platform/billing/page.tsx.
 *
 * Awaiting wiring to the platform billing aggregator before any
 * numbers are surfaced. Mirrors the LiveDataRequiredPage pattern of
 * the legacy app.
 */
export default function PlatformBillingPage() {
  return (
    <PageShell
      title="Platform billing"
      subtitle="Cross-tenant billing rollups — invoices, MRR, dunning."
    >
      <LiveDataRequiredPanel
        feature="Platform billing"
        description="Billing rollups render only from the live billing aggregator. The console re-enables once the upstream service is online."
      />
    </PageShell>
  );
}
