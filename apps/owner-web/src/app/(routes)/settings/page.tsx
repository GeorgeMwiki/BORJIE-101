import { ScreenHeader } from '@/components/ScreenHeader';
import { EmptyState } from '@/components/shared/EmptyState';

/**
 * O-W-22 — Settings. Live data path: GET /api/v1/mining/internal/tenants/me
 * (users, plan, autonomy policy). Empty state shown until that wiring
 * lands; mock data has been removed.
 */
export default function SettingsPage() {
  return (
    <>
      <ScreenHeader slug="settings" />
      <div className="px-8 py-6">
        <EmptyState
          title="Settings not yet wired"
          description="Users, plan, and autonomy policy load from the live tenant API. Sign in and connect your tenant to see real data here."
          hint="GET /api/v1/mining/internal/tenants/me (pending)"
        />
      </div>
    </>
  );
}
