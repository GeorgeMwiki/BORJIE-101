import { ScreenHeader } from '@/components/ScreenHeader';
import { EmptyState } from '@/components/shared/EmptyState';

/**
 * O-W-08 — People & roles. Live data path:
 * GET /api/v1/mining/people/org + /people/advances + /people/productivity.
 */
export default function PeoplePage() {
  return (
    <>
      <ScreenHeader slug="people" />
      <div className="px-8 py-6">
        <EmptyState
          title="People surface not yet wired"
          description="Org chart, advances ledger, and productivity load from the live HR API. Sign in to connect."
          hint="GET /api/v1/mining/people/org (pending)"
        />
      </div>
    </>
  );
}
