import { ScreenHeader } from '@/components/ScreenHeader';
import { FleetMaintenanceSurface } from '@/components/fleet/FleetMaintenanceSurface';

/**
 * O-W-09 — Assets & fleet. Wired to the live asset-maintenance feed
 * (GET /api/v1/mining/maintenance via useMaintenanceList). The surface
 * renders its own real loading / empty / error states.
 *
 * NOTE: a dedicated fleet-units register + match-factor computation are
 * separate, not-yet-built gateway endpoints
 * (/api/v1/mining/fleet/units, /api/v1/mining/fleet/match-factor). See
 * the gateway-wave list — we do not fabricate them.
 */
export default function FleetPage() {
  return (
    <>
      <ScreenHeader slug="fleet" />
      <div className="px-8 py-6">
        <FleetMaintenanceSurface />
      </div>
    </>
  );
}
