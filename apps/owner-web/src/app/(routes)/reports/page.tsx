import Link from 'next/link';
import { FileText, Sparkles } from 'lucide-react';
import { PageHero } from '@/components/shared/PageHero';
import { ReportForm } from '@/components/reports/ReportForm';
import { ReportPlayerPanel } from '@/components/reports/ReportPlayerPanel';
import { getOwnerSession } from '@/lib/session';

/**
 * O-W-18 — Reports & exports.
 *
 * Owner picks a report kind from the radio catalogue, sets a date
 * range, taps Generate. The mutation POSTs to
 * /api/v1/owner/reports/generate and surfaces the resulting PDF URL in
 * a toast (falls back to a mock 600ms generator when the gateway is
 * unreachable). Above the form, ReportPlayerPanel mounts a Plyr audio
 * player for the voiced narration of any recent report.
 */
export default async function ReportsPage() {
  const session = await getOwnerSession();
  const isSw = session.languagePreference === 'sw';
  return (
    <div className="space-y-8 px-8 py-8">
      <PageHero
        slug="reports"
        actions={
          <>
            <Link
              href="/reports/library"
              className="inline-flex items-center gap-2 rounded-full bg-signal-500 px-4 py-2 text-xs font-semibold text-background hover:bg-signal-400"
            >
              <FileText className="h-3.5 w-3.5" />
              {isSw ? 'Maktaba ya ripoti' : 'Report library'}
            </Link>
            <Link
              href="/ask?prompt=reports"
              className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-xs font-semibold text-foreground hover:bg-surface"
            >
              <Sparkles className="h-3.5 w-3.5" />
              {isSw ? 'Uliza kuhusu chati' : 'Ask about analytics'}
            </Link>
          </>
        }
      />
      <ReportPlayerPanel />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <ReportForm />
        </div>
        <div className="lg:col-span-1">
          <div className="rounded-2xl border border-border bg-surface/40 p-5">
            <h3 className="text-sm font-semibold text-foreground">
              {isSw ? 'Uthibitisho' : 'Provenance'}
            </h3>
            <p className="mt-1 text-xs text-neutral-400">
              {isSw
                ? 'Kila namba inarejea kwa LMBM.'
                : 'Every figure cites a chunk in the LMBM.'}
            </p>
            <p className="mt-4 text-sm leading-relaxed text-neutral-300">
              {isSw
                ? 'Ripoti zilizotengenezwa zinajumuisha kiambatisho cha hashi kwa kila takwimu, kuweza kufuatiliwa nyuma kwa ledger ya chanzo au chunk ya hati. Ripoti zinabaki kusomwa hata bila intaneti.'
                : 'Generated reports include an appendix with a hash anchor for every figure, traceable back to the source ledger or document chunk. Reports stay readable offline; sharing requires explicit access grants.'}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
