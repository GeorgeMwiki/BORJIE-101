import { getOwnerSession } from '@/lib/session';
import { MarketIntelligencePanel } from '@/components/market/MarketIntelligencePanel';
import { marketPageStrings as M } from '@/i18n/strings/market-page';

/**
 * Market intelligence — owner market surface.
 *
 * Real commodity market advisor: live price (gold from the LBMA fix in
 * `fx_rates`), buy/sell/hold signal with causal reasoning, 90-day demand
 * forecast band, and active disruption alerts. Backed by
 * `@borjie/market-intelligence` through
 * `/api/v1/mining/market-intelligence/*`.
 *
 * This is a NEW route; it renders a self-contained header (no shared
 * screen-registry slug) so it adds no coupling to the nav. Add a
 * sidebar entry pointing at `/market` to surface it in navigation.
 */
export default async function MarketPage() {
  const session = await getOwnerSession();
  const isSw = session.languagePreference === 'sw';
  return (
    <div className="space-y-8 px-8 py-8">
      <header>
        <h1 className="text-xl font-semibold text-foreground">
          {isSw ? M.title.sw : M.title.en}
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-neutral-400">
          {isSw ? M.subtitle.sw : M.subtitle.en}
        </p>
      </header>
      <MarketIntelligencePanel locale={session.languagePreference} />
    </div>
  );
}
