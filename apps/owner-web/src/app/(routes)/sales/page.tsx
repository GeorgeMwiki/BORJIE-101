import { ScreenHeader } from '@/components/ScreenHeader';
import { PlaceholderCard } from '@/components/PlaceholderCard';

/**
 * O-W-13 — Sales & pipeline.
 *
 * Net price comparison per buyer (after refining, transport,
 * royalties, treasury haircut) and the payment trace so the owner
 * sees actual TZS landed vs the headline quote.
 */
export default function SalesPage() {
  return (
    <>
      <ScreenHeader slug="sales" />
      <div className="grid grid-cols-1 gap-4 px-8 py-6 md:grid-cols-3">
        <PlaceholderCard title="Net-price comparison">
          Per-buyer net price = headline - assay deductions - transport -
          royalty - treasury haircut. Top buyer wins by default.
        </PlaceholderCard>
        <PlaceholderCard title="Payment trace">
          Invoice -> bank credit -> TZS conversion -> deposit. Aging
          highlighted.
        </PlaceholderCard>
        <PlaceholderCard title="Pipeline">
          Open offers and counter-offers, with timer / decision recommender
          from the Sales agent.
        </PlaceholderCard>
      </div>
    </>
  );
}
