import { ScreenHeader } from '@/components/ScreenHeader';
import { EmptyState } from '@/components/shared/EmptyState';

/**
 * O-W-14 — Compliance centre. Live data path:
 * GET /api/v1/mining/compliance/checklist + /citations.
 */
export default function CompliancePage() {
  return (
    <>
      <ScreenHeader slug="compliance" />
      <div className="px-8 py-6">
        <EmptyState
          title="Compliance centre not yet wired"
          description="Citation library and action checklist load from the live compliance API. Sign in to connect."
          hint="GET /api/v1/mining/compliance/checklist (pending)"
        />
      </div>
    </>
  );
}
