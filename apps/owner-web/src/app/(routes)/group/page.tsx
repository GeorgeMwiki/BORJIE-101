import { ScreenHeader } from '@/components/ScreenHeader';
import { EstateOverview } from '@/components/estate/EstateOverview';
import { EstateGraphPanel } from '@/components/estate/EstateGraphPanel';
import { getOwnerSession } from '@/lib/session';

/**
 * O-W-19 — Multi-company group view. Wired to the live estate surface
 * (GET /api/v1/estate/groups + /api/v1/estate/entities via
 * useEstateGroups / useEstateEntities) — the owner-accessible holding /
 * subsidiary structure. EstateOverview renders its own real loading /
 * empty / error states (no fabricated data).
 *
 * NOTE: a per-tenant cash / production / compliance financial ROLLUP
 * across the group is a separate, not-yet-built gateway endpoint (the
 * original `internal/tenants?group=me` is SUPER_ADMIN-only and not
 * owner-callable). See the gateway-wave list.
 */
export default async function GroupPage() {
  const session = await getOwnerSession();
  return (
    <>
      <ScreenHeader slug="group" />
      <div className="space-y-6 px-8 py-6">
        <EstateOverview locale={session.languagePreference} />
        <EstateGraphPanel locale={session.languagePreference} />
      </div>
    </>
  );
}
