import { ScreenHeader } from '@/components/ScreenHeader';
import { PlaceholderCard } from '@/components/PlaceholderCard';

/**
 * O-W-08 — People & roles.
 *
 * Org chart + advances ledger + productivity. Most artisanal /
 * small-mid operators run informal advances against wages; the
 * ledger keeps that visible and reconciled rather than hidden in a
 * supervisor&apos;s notebook.
 */
export default function PeoplePage() {
  return (
    <>
      <ScreenHeader slug="people" />
      <div className="grid grid-cols-1 gap-4 px-8 py-6 md:grid-cols-3">
        <PlaceholderCard title="Org chart">
          Tree view: owner, mine manager, supervisors, operators, lab,
          security. Drag to restructure (with audit).
        </PlaceholderCard>
        <PlaceholderCard title="Advances ledger">
          Per-person advances vs wages owed. Aging buckets. Settlement
          schedule.
        </PlaceholderCard>
        <PlaceholderCard title="Productivity by phase">
          Tonnes / hour by extraction phase. Outliers flagged for retraining
          or reassignment.
        </PlaceholderCard>
      </div>
    </>
  );
}
