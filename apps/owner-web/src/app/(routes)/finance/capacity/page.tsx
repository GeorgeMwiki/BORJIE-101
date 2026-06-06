import { TrendingUp } from 'lucide-react';
import { CapacityExpansionPanel } from '@/components/finance/CapacityExpansionPanel';
import { getOwnerSession } from '@/lib/session';

/**
 * Finance → Capacity Expansion.
 *
 * NPV / IRR / payback advisor backed by the pure-compute
 * `@borjie/capacity-expansion-advisor` package via
 * `/api/v1/mining/capacity-expansion/*`. The owner models expansion
 * scenarios (new shaft / new site / processing upgrade), and the advisor
 * scores + ranks them by NPV and returns evidence-cited recommendations.
 *
 * Self-contained header (no shared screen-registry slug) so this route
 * stands alone without touching the shared `screens.ts` catalogue. All
 * money is rendered in the owner-supplied currency (no hard-coded code).
 */
export default async function CapacityExpansionPage() {
  const session = await getOwnerSession();
  const isSw = session.languagePreference === 'sw';

  return (
    <div className="space-y-8 px-8 py-8">
      <header className="border-b border-border pb-6">
        <div className="flex flex-wrap items-center gap-2 font-mono text-tiny uppercase tracking-eyebrow-wide text-signal-500">
          <TrendingUp className="h-3.5 w-3.5" />
          <span>{isSw ? 'Upanuzi wa uwezo' : 'Capacity expansion'}</span>
        </div>
        <h1 className="mt-3 font-display text-3xl font-medium tracking-tight text-foreground sm:text-4xl">
          {isSw ? 'Pima upanuzi kifedha' : 'Weigh expansion financially'}
        </h1>
        <p className="mt-1 text-sm italic text-neutral-500">
          {isSw
            ? 'NPV, IRR na marejesho — kwa kila hali ya upanuzi.'
            : 'NPV, IRR and payback — for every expansion scenario.'}
        </p>
        <p className="mt-4 max-w-2xl text-sm leading-relaxed text-neutral-300">
          {isSw
            ? 'Tengeneza hali za upanuzi (shimo jipya, eneo jipya, au kuboresha usindikaji), kisha mshauri huzipanga kwa NPV na hutoa mapendekezo yenye ushahidi ili kuongoza mtaji wako.'
            : 'Model expansion scenarios (new shaft, new site, or a processing upgrade), and the advisor ranks them by NPV and returns evidence-cited recommendations to guide your capital.'}
        </p>
      </header>

      <CapacityExpansionPanel locale={session.languagePreference} />
    </div>
  );
}
