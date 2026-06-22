import { ScreenHeader } from '@/components/ScreenHeader';
import { FleetMaintenanceSurface } from '@/components/fleet/FleetMaintenanceSurface';
import { FleetOpsSurface } from '@/components/fleet/FleetOpsSurface';
import { MinePlannerAdvisorPanel } from '@/components/fleet/MinePlannerAdvisorPanel';
import { getOwnerSession } from '@/lib/session';

/**
 * O-W-09 — Assets & fleet. Wired to two LIVE surfaces:
 *   - FleetOpsSurface → REAL per-vehicle cost of ownership computed by
 *     `@borjie/fleet-management` (GET /api/v1/mining/fleet-ops/tco) over
 *     the tenant's assets + fuel logs + maintenance events.
 *   - FleetMaintenanceSurface → asset-maintenance feed
 *     (GET /api/v1/mining/maintenance).
 * Each surface renders its own real loading / empty / error states, and
 * the active locale is seeded from the server session so SSR + first
 * paint agree (zero-mix canon).
 */
export default async function FleetPage() {
  const session = await getOwnerSession();
  const locale = session.languagePreference;
  return (
    <>
      <ScreenHeader slug="fleet" />
      <div className="space-y-6 px-8 py-6">
        <FleetOpsSurface locale={locale} />
        <MinePlannerAdvisorPanel locale={locale} />
        <FleetMaintenanceSurface locale={locale} />
      </div>
    </>
  );
}
