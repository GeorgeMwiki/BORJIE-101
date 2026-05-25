import { PageShell } from '@/components/migrated/PageShell';
import { LiveDataRequiredPanel } from '@/components/migrated/LiveDataRequiredPanel';

/**
 * Platform-scope feature-flags surface — migrated stub from
 * apps/admin-portal/src/app/platform/feature-flags/page.tsx. The
 * caller-scope flag editor lives at /feature-flags; this surface is
 * for global flag definitions and is awaiting backend wiring.
 */
export default function PlatformFeatureFlagsPage() {
  return (
    <PageShell
      title="Platform feature flags"
      subtitle="Global flag definitions across every Borjie tenant."
    >
      <LiveDataRequiredPanel
        feature="Platform feature flags"
        description="The global flag console renders only from the live flag-registry service. Visit /feature-flags for caller-scoped flag toggles."
      />
    </PageShell>
  );
}
