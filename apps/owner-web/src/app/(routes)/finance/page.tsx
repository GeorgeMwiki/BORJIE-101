import Link from 'next/link';
import { Calculator, Sparkles } from 'lucide-react';
import { PageHero } from '@/components/shared/PageHero';
import { BreakEvenSlider } from '@/components/finance/BreakEvenSlider';
import { RoyaltyDraftPanel } from '@/components/finance/RoyaltyDraftPanel';
import { getOwnerSession } from '@/lib/session';

/**
 * O-W-12 — Cost & finance.
 *
 * Composition mirrors LitFin's borrower-finance page rhythm:
 *  1. Page hero with primary CTA (draft month-end royalty).
 *  2. Royalty draft panel — monthly cards with mineral / rate /
 *     draft amount / signature status + a one-click batch-sign CTA.
 *  3. Two-up grid: break-even sensitivity slider (left) plus a
 *     provenance panel describing how the P&L gets composed.
 */
export default async function FinancePage() {
  const session = await getOwnerSession();
  const isSw = session.languagePreference === 'sw';
  return (
    <div className="space-y-8 px-8 py-8">
      <PageHero
        slug="finance"
        actions={
          <>
            <Link
              href="/finance/royalties/sign"
              className="inline-flex items-center gap-2 rounded-full bg-signal-500 px-4 py-2 text-xs font-semibold text-background hover:bg-signal-400"
            >
              <Calculator className="h-3.5 w-3.5" />
              {isSw ? 'Tayarisha rasimu ya mrabaha' : 'Draft month-end royalty'}
            </Link>
            <Link
              href="/ask?prompt=finance"
              className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-xs font-semibold text-foreground hover:bg-surface"
            >
              <Sparkles className="h-3.5 w-3.5" />
              {isSw ? 'Uliza kuhusu P&L' : 'Ask about P&L'}
            </Link>
          </>
        }
      />
      <RoyaltyDraftPanel locale={session.languagePreference} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <BreakEvenSlider
          initialGoldUsdOz={2384}
          initialTzsUsd={2585}
          initialUnitCostTzsPerG={104_000}
        />
        <div className="rounded-2xl border border-border bg-surface/40 p-5">
          <h3 className="text-sm font-semibold text-foreground">
            {isSw ? 'Jinsi P&L inavyojengwa' : 'How the P&L composes'}
          </h3>
          <p className="mt-2 text-xs leading-relaxed text-neutral-300">
            {isSw
              ? 'P&L ya kila mwezi inaungana toka ledger ya kuingia mara mbili ya LedgerService, na FX revaluation inafanyika kwa kiwango cha BoT cha siku ya mwisho ya mwezi. Kila takwimu inarudishwa hadi kwa sehemu yake ya chanzo (parcel, sale, fuel slip, payroll line) ili kwamba ukaguzi unaweza kuthibitisha kila line.'
              : 'The monthly P&L composes from the LedgerService double-entry posting, with FX revaluation booked at the month-end BoT rate. Every figure traces back to its source artefact (parcel, sale, fuel slip, payroll line) so an auditor can verify each line directly against the immutable journal.'}
          </p>
        </div>
      </div>
    </div>
  );
}
