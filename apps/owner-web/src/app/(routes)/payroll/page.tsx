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
import { EmptyState as ScreenEmptyState } from '@/components/shared/EmptyState';
import { pickByLocale } from '@/lib/locale-shared';
import { routesAStrings as S } from '@/i18n/strings/routes-a';

export default async function PayrollPage() {
  const session = await getOwnerSession();
  const isSw = session.languagePreference === 'sw';
  return (
    <div className="space-y-8 px-8 py-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold text-foreground">
          {isSw ? S.payroll.title.sw : S.payroll.title.en}
        </h1>
        <p className="text-sm text-muted-foreground">
          {isSw ? S.payroll.intro.sw : S.payroll.intro.en}
        </p>
      </header>

      <section className="rounded-2xl border border-border bg-surface p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-foreground">
              {isSw
                ? S.payroll.runNewPeriodHeading.sw
                : S.payroll.runNewPeriodHeading.en}
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {isSw
                ? S.payroll.runNewPeriodBody.sw
                : S.payroll.runNewPeriodBody.en}
            </p>
          </div>
          <Banknote className="h-8 w-8 text-primary" />
        </div>
        <Link
          href="/mwikila"
          className="mt-6 inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-xs font-semibold text-foreground hover:bg-background"
        >
          {isSw ? S.payroll.openMwikilaCta.sw : S.payroll.openMwikilaCta.en}
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {isSw ? S.payroll.recentRunsHeading.sw : S.payroll.recentRunsHeading.en}
        </h2>
        <ScreenEmptyState
          icon={<Banknote className="h-6 w-6" />}
          title={pickByLocale(session.languagePreference, S.payroll.noRunsTitle)}
          description={pickByLocale(session.languagePreference, S.payroll.noRuns)}
        />
      </section>
    </div>
  );
}
