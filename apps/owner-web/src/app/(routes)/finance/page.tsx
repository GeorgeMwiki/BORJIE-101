import { ScreenHeader } from '@/components/ScreenHeader';
import { PlaceholderCard } from '@/components/PlaceholderCard';

/**
 * O-W-12 — Cost & finance.
 *
 * Full P&L, unit economics, and the break-even sensitivity ladder.
 * Everything anchored in source ledgers (no spreadsheet of unknown
 * provenance) and convertible to a one-page banker pack on demand.
 */
export default function FinancePage() {
  return (
    <>
      <ScreenHeader slug="finance" />
      <div className="grid grid-cols-1 gap-4 px-8 py-6 md:grid-cols-3">
        <PlaceholderCard title="P&L">
          Monthly P&L, drill-down to ledger line. Variance vs budget by
          category.
        </PlaceholderCard>
        <PlaceholderCard title="Unit economics">
          TZS / g (or TZS / lb for coltan) with margin waterfall — gross,
          contribution, EBITDA per unit.
        </PlaceholderCard>
        <PlaceholderCard title="Break-even sensitivity">
          Slider matrix: gold price x grade x recovery — green/red the
          regions where the site clears unit cost.
        </PlaceholderCard>
      </div>
    </>
  );
}
