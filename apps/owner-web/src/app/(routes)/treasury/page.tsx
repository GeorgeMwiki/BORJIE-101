import { ScreenHeader } from '@/components/ScreenHeader';
import { FxChart } from '@/components/treasury/FxChart';
import { SellSimulator } from '@/components/treasury/SellSimulator';
import { CliffBanner } from '@/components/treasury/CliffBanner';

/**
 * O-W-17 — FX & treasury.
 *
 * Live FX & gold sparkline (recharts), sell-vs-stockpile simulator
 * (gold + FX + grammes + hold-window sliders → projected net outcome
 * with confidence bands), and the 27-Mar-2026 cliff tracker banner
 * (passed by 8 weeks as of cockpit "today" → remediation copy).
 */
export default function TreasuryPage() {
  return (
    <>
      <ScreenHeader slug="treasury" />
      <div className="space-y-4 px-8 py-6">
        <CliffBanner />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <FxChart />
          </div>
          <div className="lg:col-span-1">
            <SellSimulator
              initialGoldUsdOz={2384}
              initialTzsUsd={2585}
              initialGrammes={12_000}
            />
          </div>
        </div>
      </div>
    </>
  );
}
