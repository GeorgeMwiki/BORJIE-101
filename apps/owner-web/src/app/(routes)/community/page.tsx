import { ScreenHeader } from '@/components/ScreenHeader';
import { EmptyState } from '@/components/shared/EmptyState';

/**
 * O-W-16 — Community & CSR. Live data path:
 * GET /api/v1/mining/community/commitments + /community/grievances.
 */
export default function CommunityPage() {
  return (
    <>
      <ScreenHeader slug="community" />
      <div className="px-8 py-6">
        <EmptyState
          title="Community surface not yet wired"
          description="CSR commitments and grievances load from the live community API. Sign in to connect."
          hint="GET /api/v1/mining/community/commitments (pending)"
        />
      </div>
    </>
  );
}
