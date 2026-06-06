import { ScreenHeader } from '@/components/ScreenHeader';
import { GeologyPanel } from '@/components/owner-os/panels/GeologyPanel';
import { getOwnerSession } from '@/lib/session';

/**
 * O-W-11 — Geology workbench. Wired to the live drill-holes surface
 * (GET /api/v1/mining/drill-holes via useDrillHoles). The panel renders
 * its own real loading / empty / error states (no fabricated data).
 */
export default async function GeologyPage() {
  const session = await getOwnerSession();
  return (
    <>
      <ScreenHeader slug="geology" />
      <div className="px-8 py-6">
        <GeologyPanel
          tabId="route:geology"
          context={{}}
          locale={session.languagePreference}
        />
      </div>
    </>
  );
}
