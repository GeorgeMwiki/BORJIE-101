import { ScreenHeader } from '@/components/ScreenHeader';
import { PlaceholderCard } from '@/components/PlaceholderCard';

/**
 * O-W-07 — Licence cockpit.
 *
 * Per-licence detail: renewal pack readiness, dormancy score (am I
 * at risk of forfeiture under the Mining Act?), and the historical
 * payment trail. Anchors every action to a citation in the regulator
 * library.
 */
export default function LicencePage() {
  return (
    <>
      <ScreenHeader slug="licence" />
      <div className="grid grid-cols-1 gap-4 px-8 py-6 md:grid-cols-3">
        <PlaceholderCard title="Renewal pack">
          Checklist of every document the renewal needs. Auto-populated by the
          Document agent; missing items flagged red.
        </PlaceholderCard>
        <PlaceholderCard title="Dormancy score">
          0 to 100 score — how close is this licence to dormancy-based
          forfeiture? Citations to the Mining Act 2010 sections.
        </PlaceholderCard>
        <PlaceholderCard title="Payment history">
          Annual fees, royalties paid, receipts hashed and stored. Time-series
          chart of obligations vs payments.
        </PlaceholderCard>
      </div>
    </>
  );
}
