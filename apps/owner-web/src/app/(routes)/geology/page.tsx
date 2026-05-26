import { ScreenHeader } from '@/components/ScreenHeader';
import { EmptyState } from '@/components/shared/EmptyState';

/**
 * O-W-11 — Geology workbench. Live data path:
 * GET /api/v1/mining/geology/resource + /geology/qaqc.
 */
export default function GeologyPage() {
  return (
    <>
      <ScreenHeader slug="geology" />
      <div className="px-8 py-6">
        <EmptyState
          title="Geology workbench not yet wired"
          description="Resource snapshot and QA/QC load from the live geology API. Sign in to connect."
          hint="GET /api/v1/mining/geology/resource (pending)"
        />
      </div>
    </>
  );
}
