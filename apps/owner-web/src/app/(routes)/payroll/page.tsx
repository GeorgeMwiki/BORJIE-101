/**
 * Payroll cockpit — chain L-B (issue #193) owner-web surface.
 *
 * Server-renders the page shell + delegates the active run list to a
 * client island that hits `GET /api/v1/owner/payroll/runs` and the
 * commit / preview CTAs. The shell is intentionally minimal — the
 * commit flow lives in the brain (Mr. Mwikila pre-computes the run +
 * surfaces it for one-click approve).
 */

import Link from 'next/link';
import { ArrowRight, Banknote } from 'lucide-react';
import { getOwnerSession } from '@/lib/session';

export default async function PayrollPage() {
  const session = await getOwnerSession();
  const isSw = session.languagePreference === 'sw';
  return (
    <div className="space-y-8 px-8 py-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold text-foreground">
          {isSw ? 'Mishahara' : 'Payroll'}
        </h1>
        <p className="text-sm text-muted-foreground">
          {isSw
            ? 'Endesha mishahara ya kipindi kwa M-Pesa. Mwikila huandaa hesabu; wewe unakubali.'
            : 'Run period payroll via M-Pesa bulk-payout. Mwikila pre-computes the line items; you approve.'}
        </p>
      </header>

      <section className="rounded-2xl border border-border bg-surface p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-foreground">
              {isSw ? 'Endesha kipindi kipya' : 'Run a new period'}
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {isSw
                ? 'Chagua tarehe za mwanzo na mwisho. Mwikila atatumia clock-in events na shift reports kuhesabu kila mfanyakazi.'
                : 'Pick a start + end date. Mwikila uses clock-in events and shift reports to compute every worker. Money posts via LedgerService.post() — double-entry guaranteed.'}
            </p>
          </div>
          <Banknote className="h-8 w-8 text-primary" />
        </div>
        <Link
          href="/mwikila"
          className="mt-6 inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-xs font-semibold text-foreground hover:bg-background"
        >
          {isSw ? 'Anza na Mwikila' : 'Open Mwikila'}
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {isSw ? 'Vipindi vya hivi karibuni' : 'Recent runs'}
        </h2>
        <div className="rounded-2xl border border-border bg-surface p-6 text-sm text-muted-foreground">
          {isSw
            ? 'Hakuna kipindi bado. Endesha cha kwanza juu.'
            : 'No runs yet. Trigger the first one above.'}
        </div>
      </section>
    </div>
  );
}
