import { ScreenHeader } from '@/components/ScreenHeader';
import { ReportForm } from '@/components/reports/ReportForm';
import { ReportPlayerPanel } from '@/components/reports/ReportPlayerPanel';
import { SectionCard } from '@/components/shared/SectionCard';

/**
 * O-W-18 — Reports & exports.
 *
 * Owner picks a report kind from the radio catalogue, sets a date
 * range, taps Generate. The mutation POSTs to
 * /api/v1/owner/reports/generate and surfaces the resulting PDF URL in
 * a toast (falls back to a mock 600ms generator when the gateway is
 * unreachable).
 *
 * Above the list, ReportPlayerPanel mounts a Plyr-skinned audio
 * player so the owner can listen to the voiced narration of any
 * recent report. Audio metadata is fetched from
 * /api/v1/mining/reports/:id/audio.
 */
export default function ReportsPage() {
  return (
    <>
      <ScreenHeader slug="reports" />
      <div className="flex flex-col gap-4 px-8 py-6">
        <ReportPlayerPanel />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <ReportForm />
          </div>
          <div className="lg:col-span-1">
            <SectionCard
              title="Provenance"
              subtitle="Every number in every report cites a chunk in the LMBM."
            >
              <p className="text-sm text-neutral-300">
                Generated reports include an appendix with a hash anchor for
                every figure, traceable back to the source ledger or document
                chunk. Reports remain readable when offline; sharing requires
                the recipient to be granted access.
              </p>
            </SectionCard>
          </div>
        </div>
      </div>
    </>
  );
}
