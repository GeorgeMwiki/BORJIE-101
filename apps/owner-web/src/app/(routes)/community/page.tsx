import { ScreenHeader } from '@/components/ScreenHeader';
import { CSRCommunityPanel } from '@/components/owner-os/panels/CSRCommunityPanel';
import { getOwnerSession } from '@/lib/session';

/**
 * O-W-16 — Community & CSR. Wired to the live CSR plans surface
 * (GET /api/v1/mining/csr-plans via useCsrPlans). The panel renders its
 * own real loading / empty / error states (no fabricated data).
 */
export default async function CommunityPage() {
  const session = await getOwnerSession();
  return (
    <>
      <ScreenHeader slug="community" />
      <div className="px-8 py-6">
        <CSRCommunityPanel
          tabId="route:community"
          context={{}}
          locale={session.languagePreference}
        />
      </div>
    </>
  );
}
