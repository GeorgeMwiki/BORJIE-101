import { ScreenHeader } from '@/components/ScreenHeader';
import { PlaceholderCard } from '@/components/PlaceholderCard';

/**
 * O-W-19 — Multi-company group view.
 *
 * Only available on the `kampuni` / `group` plans. Rolls cockpit
 * cards across every tenant the owner controls, with intercompany
 * elimination on the financial side.
 */
export default function GroupPage() {
  return (
    <>
      <ScreenHeader slug="group" />
      <div className="grid grid-cols-1 gap-4 px-8 py-6 md:grid-cols-3">
        <PlaceholderCard title="Group cockpit rollup">
          Cross-tenant view of cash, production, runway, compliance and
          risk. Tenant chips with drill-through.
        </PlaceholderCard>
        <PlaceholderCard title="Intercompany ledger">
          Loans, services, shared overhead — eliminated for the group P&L.
        </PlaceholderCard>
        <PlaceholderCard title="Plan & access">
          Which tenant is on which plan. Add / remove tenants from the
          group. RBAC bridge.
        </PlaceholderCard>
      </div>
    </>
  );
}
