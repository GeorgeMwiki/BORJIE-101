import { ScreenHeader } from '@/components/ScreenHeader';
import { PnlTable } from '@/components/finance/PnlTable';
import { BreakEvenSlider } from '@/components/finance/BreakEvenSlider';
import { PNL_MOCK } from '@/lib/mocks/finance';

/**
 * O-W-12 — Cost & finance.
 *
 * Full P&L (revenue split by mineral, costs by category, OPEX, FX
 * revaluation, EBITDA bottom line) plus a break-even sensitivity
 * slider that recomputes net margin TZS/g in real time as the owner
 * scrubs gold price / FX / unit cost assumptions.
 */
export default function FinancePage() {
  return (
    <>
      <ScreenHeader slug="finance" />
      <div className="grid grid-cols-1 gap-4 px-8 py-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <PnlTable rows={PNL_MOCK} />
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
