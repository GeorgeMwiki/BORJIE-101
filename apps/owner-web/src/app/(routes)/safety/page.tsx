import { ScreenHeader } from '@/components/ScreenHeader';
import { EmptyState } from '@/components/shared/EmptyState';

/**
 * O-W-15 — Safety & EHS. Live data path:
 * GET /api/v1/mining/incidents + /safety/critical-controls.
 */
export default function SafetyPage() {
  return (
    <>
      <ScreenHeader slug="safety" />
      <div className="px-8 py-6">
        <EmptyState
          title="Safety surface not yet wired"
          description="Critical controls and incidents load from the live safety API. Sign in to connect."
          hint="GET /api/v1/mining/safety/critical-controls (pending)"
        />
      </div>
    </>
  );
}
