import { ScreenHeader } from '@/components/ScreenHeader';
import { EmptyState } from '@/components/shared/EmptyState';

/**
 * O-W-19 — Multi-company group view. Live data path:
 * GET /api/v1/mining/internal/tenants?group=me. Empty state until the
 * group-rollup endpoint lands.
 */
export default function GroupPage() {
  return (
    <>
      <ScreenHeader slug="group" />
      <div className="px-8 py-6">
        <EmptyState
          title="Group rollup not yet wired"
          description="Per-tenant cash, production, and compliance rollups load from the live tenants API. Sign in to connect."
          hint="GET /api/v1/mining/internal/tenants?group=me (pending)"
        />
      </div>
    </>
  );
}
