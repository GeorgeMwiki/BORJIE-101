import { ScreenHeader } from '@/components/ScreenHeader';
import { PlaceholderCard } from '@/components/PlaceholderCard';

/**
 * O-W-15 — Safety & EHS.
 *
 * Critical-controls register (the few barriers that, if absent,
 * cause a fatality) plus an incident heatmap. Owner-facing — the
 * worker side captures the raw inputs.
 */
export default function SafetyPage() {
  return (
    <>
      <ScreenHeader slug="safety" />
      <div className="grid grid-cols-1 gap-4 px-8 py-6 md:grid-cols-3">
        <PlaceholderCard title="Critical controls">
          Top barriers per site: ground support, ventilation, water mgmt,
          tailings freeboard. Live status from worker check-ins.
        </PlaceholderCard>
        <PlaceholderCard title="Incident heatmap">
          Map overlay of incidents by location + severity. Clusters trigger
          Risk-agent investigations.
        </PlaceholderCard>
        <PlaceholderCard title="EHS programme">
          Training currency, PPE issuance, drill records — per-person status.
        </PlaceholderCard>
      </div>
    </>
  );
}
