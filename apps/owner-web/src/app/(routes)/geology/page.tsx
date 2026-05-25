import { ScreenHeader } from '@/components/ScreenHeader';
import { PlaceholderCard } from '@/components/PlaceholderCard';

/**
 * O-W-11 — Geology workbench.
 *
 * Owner-side view of the geology agent's evidence stack. 3D site
 * view (drill collars + vein), triangulated resource model, assay
 * QA/QC charts (duplicates, blanks, CRMs).
 */
export default function GeologyPage() {
  return (
    <>
      <ScreenHeader slug="geology" />
      <div className="grid grid-cols-1 gap-4 px-8 py-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="h-[480px] rounded-lg border border-dashed border-border bg-surface/30 p-6 text-sm text-neutral-400">
            3D site view + vein triangulation
            <div className="mt-2 text-xs text-neutral-500">
              Three.js / deck.gl scene with drill collars, traces, and a
              triangulated vein surface.
            </div>
          </div>
        </div>
        <div className="space-y-3">
          <PlaceholderCard title="Assay QA / QC">
            Duplicates, blanks, CRMs — control charts with red flags on rule
            breaks.
          </PlaceholderCard>
          <PlaceholderCard title="Resource snapshot">
            Indicated / inferred tonnage and grade, last updated and signed
            off.
          </PlaceholderCard>
        </div>
      </div>
    </>
  );
}
