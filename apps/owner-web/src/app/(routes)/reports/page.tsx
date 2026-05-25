import { ScreenHeader } from '@/components/ScreenHeader';
import { PlaceholderCard } from '@/components/PlaceholderCard';

/**
 * O-W-18 — Reports & exports.
 *
 * One catalogue of every templated report (daily owner brief, weekly
 * strategy memo, monthly business report, site daily, investor /
 * bank pack, board pack, audit pack, community update).
 */
export default function ReportsPage() {
  return (
    <>
      <ScreenHeader slug="reports" />
      <div className="grid grid-cols-1 gap-4 px-8 py-6 md:grid-cols-3">
        <PlaceholderCard title="Scheduled reports">
          Daily Owner Brief 06:00, Weekly Strategy Memo Sun 18:00, Monthly
          Business Report 1st. Toggle delivery channel.
        </PlaceholderCard>
        <PlaceholderCard title="On-demand packs">
          Investor / bank pack, board pack, audit pack, community update.
          Generate -> review -> export PDF.
        </PlaceholderCard>
        <PlaceholderCard title="Provenance">
          Every number in every report links back to its evidence in the
          LMBM (per BOJI §13).
        </PlaceholderCard>
      </div>
    </>
  );
}
