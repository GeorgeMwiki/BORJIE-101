import { ScreenHeader } from '@/components/ScreenHeader';
import { PlaceholderCard } from '@/components/PlaceholderCard';

/**
 * O-W-09 — Assets & fleet.
 *
 * Match-factor visualisation (loader vs hauler balance) plus the
 * predictive-maintenance queue. The strategic question per BOJI §8
 * is "what is the smallest fleet that meets next 90-day plan?" — this
 * surface holds the live answer.
 */
export default function FleetPage() {
  return (
    <>
      <ScreenHeader slug="fleet" />
      <div className="grid grid-cols-1 gap-4 px-8 py-6 md:grid-cols-3">
        <PlaceholderCard title="Match-factor chart">
          Loader cycles vs hauler cycles. Imbalance = idle time = burn.
        </PlaceholderCard>
        <PlaceholderCard title="Predictive maintenance">
          Per-asset health score: hours, vibration, oil quality, last service.
          Flagged units sort to top.
        </PlaceholderCard>
        <PlaceholderCard title="Fleet utilisation">
          Heatmap by asset x day. Highlights chronic underutilisation
          candidates for sale or redeployment.
        </PlaceholderCard>
      </div>
    </>
  );
}
