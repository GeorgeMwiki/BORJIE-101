import { ScreenHeader } from '@/components/ScreenHeader';
import { PlaceholderCard } from '@/components/PlaceholderCard';

/**
 * O-W-06 — Site cockpit.
 *
 * Per-site operating cockpit. The currently-selected site (top bar)
 * scopes the page. Three vertical slices: what the shift delivered,
 * what the rock looks like, what it cost.
 */
export default function SiteCockpitPage() {
  return (
    <>
      <ScreenHeader slug="site-cockpit" />
      <div className="grid grid-cols-1 gap-4 px-8 py-6 md:grid-cols-3">
        <PlaceholderCard title="Shift reconciliation">
          Day vs night shift: tonnes mined, grade, recovered grammes, variance
          to plan. Reconciles signed-off SIC against the brain&apos;s estimate.
        </PlaceholderCard>
        <PlaceholderCard title="Geology score">
          Composite score from drill-hole density, assay QA/QC, vein
          continuity. Trend over last 30 days.
        </PlaceholderCard>
        <PlaceholderCard title="Unit economics">
          TZS / g all-in cost, broken out: extraction, processing, royalty,
          treasury haircut, CSR, overhead.
        </PlaceholderCard>
      </div>
    </>
  );
}
