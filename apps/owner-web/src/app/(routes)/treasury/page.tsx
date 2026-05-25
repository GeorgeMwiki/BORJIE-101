import { ScreenHeader } from '@/components/ScreenHeader';
import { PlaceholderCard } from '@/components/PlaceholderCard';

/**
 * O-W-17 — FX & treasury.
 *
 * Live rates, the sell-now-vs-stockpile simulator (BOJI §10.3), and
 * the 27-Mar-2026 TZS-only cliff tracker (§10.2). For most operators
 * this is the single most consequential page on the surface.
 */
export default function TreasuryPage() {
  return (
    <>
      <ScreenHeader slug="treasury" />
      <div className="grid grid-cols-1 gap-4 px-8 py-6 md:grid-cols-3">
        <PlaceholderCard title="Live FX & gold">
          BoT mid + commercial bid/ask, gold spot, last refresh. Sparkline
          for the last 30 days.
        </PlaceholderCard>
        <PlaceholderCard title="Sell-vs-stockpile simulator">
          Net-now vs probable net-in-30d under buyer / FX / production
          scenarios. Confidence interval shown.
        </PlaceholderCard>
        <PlaceholderCard title="27 March cliff tracker">
          Countdown + USD-receivable exposure that will be forced into TZS at
          BoT mid; penalty + facility-notification status.
        </PlaceholderCard>
      </div>
    </>
  );
}
