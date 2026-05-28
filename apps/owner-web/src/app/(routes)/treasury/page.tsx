import Link from 'next/link';
import { Coins, Sparkles } from 'lucide-react';
import { PageHero } from '@/components/shared/PageHero';
import { FxChart } from '@/components/treasury/FxChart';
import { SellSimulator } from '@/components/treasury/SellSimulator';
import { CliffBanner } from '@/components/treasury/CliffBanner';
import { getOwnerSession } from '@/lib/session';

/**
 * O-W-17 — FX & treasury.
 *
 * Two-column dashboard: live FX & gold sparkline (recharts) plus a
 * sell-vs-stockpile simulator (gold + FX + grammes + hold-window
 * sliders -> projected net outcome with confidence bands). A 27-Mar
 * cliff tracker banner sits above the grid as a persistent risk
 * surface until remediation completes.
 */
export default async function TreasuryPage() {
  const session = await getOwnerSession();
  const isSw = session.languagePreference === 'sw';
  return (
    <div className="space-y-8 px-8 py-8">
      <PageHero
        slug="treasury"
        actions={
          <>
            <Link
              href="/sales"
              className="inline-flex items-center gap-2 rounded-full bg-signal-500 px-4 py-2 text-xs font-semibold text-background hover:bg-signal-400"
            >
              <Coins className="h-3.5 w-3.5" />
              {isSw ? 'Tengeneza order' : 'Place sell order'}
            </Link>
            <Link
              href="/ask?prompt=treasury"
              className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-xs font-semibold text-foreground hover:bg-surface"
            >
              <Sparkles className="h-3.5 w-3.5" />
              {isSw ? 'Uliza simu ya hedge' : 'Ask about hedging'}
            </Link>
          </>
        }
      />
      <CliffBanner />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
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
  );
}
