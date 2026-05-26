import { ScreenHeader } from '@/components/ScreenHeader';
import { BreakEvenSlider } from '@/components/finance/BreakEvenSlider';
import { EmptyState } from '@/components/shared/EmptyState';

/**
 * O-W-12 — Cost & finance.
 *
 * Full P&L (revenue split by mineral, costs by category, OPEX, FX
 * revaluation, EBITDA bottom line) plus a break-even sensitivity
 * slider that recomputes net margin TZS/g in real time as the owner
 * scrubs gold price / FX / unit cost assumptions.
 *
 * Live data path: GET /api/v1/mining/finance/pnl (pending — surface
 * not yet exposed by the api-gateway). The break-even slider keeps
 * working since it is a pure client-side calculator on user inputs.
 */
export default function FinancePage() {
  return (
    <>
      <ScreenHeader slug="finance" />
      <div className="grid grid-cols-1 gap-4 px-8 py-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <EmptyState
            title="P&L not yet wired"
            description="The monthly P&L loads from the live finance API. Sign in to connect."
            hint="GET /api/v1/mining/finance/pnl (pending)"
          />
        </div>
        <div className="lg:col-span-1">
          <BreakEvenSlider
            initialGoldUsdOz={2384}
            initialTzsUsd={2585}
            initialUnitCostTzsPerG={104_000}
          />
        </div>
      </div>
    </>
  );
}
