import { ScreenHeader } from '@/components/ScreenHeader';
import { PlaceholderCard } from '@/components/PlaceholderCard';

/**
 * O-W-21 — Onboarding & data import.
 *
 * Bulk-upload PML PDFs, prior ledgers, geology reports — Document
 * agent classifies, extracts and proposes a draft LMBM the owner
 * approves chunk by chunk.
 */
export default function OnboardingPage() {
  return (
    <>
      <ScreenHeader slug="onboarding" />
      <div className="grid grid-cols-1 gap-4 px-8 py-6 md:grid-cols-3">
        <PlaceholderCard title="Bulk upload">
          Drag-drop PDFs, photos, CSVs. Per-file status: classified,
          extracted, proposed into LMBM.
        </PlaceholderCard>
        <PlaceholderCard title="Document classifier">
          Detected type (PML, EPP, lab assay, invoice, MoU). Confidence
          shown; low-confidence routed to owner review.
        </PlaceholderCard>
        <PlaceholderCard title="LMBM proposal">
          Diff view: current LMBM vs proposed-after-import. Approve per
          entity or in bulk.
        </PlaceholderCard>
      </div>
    </>
  );
}
