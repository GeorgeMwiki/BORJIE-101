import Link from 'next/link';
import { Calculator, Sparkles } from 'lucide-react';
import { PageHero } from '@/components/shared/PageHero';
import { BreakEvenSlider } from '@/components/finance/BreakEvenSlider';
import { RoyaltyDraftPanel } from '@/components/finance/RoyaltyDraftPanel';
import { PnlTableLive } from '@/components/finance/PnlTableLive';
import { getOwnerSession } from '@/lib/session';
import { SW } from '@/lib/sw-tokens';
import { routesAStrings as S } from '@/i18n/strings/routes-a';

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
              {isSw
                ? `${S.finance.draftMonthEndRoyalty.sw}${SW.royalty}`
                : S.finance.draftMonthEndRoyalty.en}
            </Link>
            <Link
              href="/ask?prompt=finance"
              className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-xs font-semibold text-foreground hover:bg-surface"
            >
              <Sparkles className="h-3.5 w-3.5" />
              {isSw ? S.finance.askAboutPnl.sw : S.finance.askAboutPnl.en}
            </Link>
          </>
        }
      />
      <RoyaltyDraftPanel locale={session.languagePreference} />
      <PnlTableLive locale={session.languagePreference} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <BreakEvenSlider
          initialGoldUsdOz={2384}
          initialTzsUsd={2585}
          initialUnitCostTzsPerG={104_000}
        />
        <div className="rounded-2xl border border-border bg-surface/40 p-5">
          <h3 className="text-sm font-semibold text-foreground">
            {isSw
              ? S.finance.howPnlComposesHeading.sw
              : S.finance.howPnlComposesHeading.en}
          </h3>
          <p className="mt-2 text-xs leading-relaxed text-neutral-300">
            {isSw
              ? S.finance.howPnlComposesBody.sw
              : S.finance.howPnlComposesBody.en}
          </p>
        </div>
      </div>
    </div>
  );
}
