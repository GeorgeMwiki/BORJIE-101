import { ScreenHeader } from '@/components/ScreenHeader';
import { LmbmSurface } from '@/components/lmbm/LmbmSurface';

/**
 * O-W-03 — LMBM graph explorer.
 *
 * Real graph viz with a deterministic radial layout (company at the
 * centre, licences / sites / docs / people / events in rings). Each
 * node opens a side panel showing attributes, validity window, and
 * the evidence chain that wrote it. A time-travel slider at the top
 * changes the as-of-date so the owner can replay history.
 */
export default function LmbmPage() {
  return (
    <>
      <ScreenHeader slug="lmbm" />
      <LmbmSurface />
    </>
  );
}
