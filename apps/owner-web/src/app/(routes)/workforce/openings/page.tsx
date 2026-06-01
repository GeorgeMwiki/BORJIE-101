/**
 * Workforce openings — chain L-A (issue #193) owner-web surface.
 *
 * Lists open `workforce_openings` rows + lets the owner post a new
 * opening. Manager approval happens on the workforce-mobile manager
 * tab; this surface is the owner's posting + audit view.
 */

import Link from 'next/link';
import { ArrowRight, Users } from 'lucide-react';
import { getOwnerSession } from '@/lib/session';
import { routesBStrings as S } from '@/i18n/strings/routes-b';

export default async function WorkforceOpeningsPage() {
  const session = await getOwnerSession();
  const isSw = session.languagePreference === 'sw';
  return (
    <div className="space-y-8 px-8 py-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold text-foreground">
          {isSw ? S.workforceOpenings.title.sw : S.workforceOpenings.title.en}
        </h1>
        <p className="text-sm text-muted-foreground">
          {isSw
            ? S.workforceOpenings.intro.sw
            : S.workforceOpenings.intro.en}
        </p>
      </header>

      <section className="rounded-2xl border border-border bg-surface p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-foreground">
              {isSw
                ? S.workforceOpenings.postHeading.sw
                : S.workforceOpenings.postHeading.en}
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {isSw
                ? S.workforceOpenings.postBody.sw
                : S.workforceOpenings.postBody.en}
            </p>
          </div>
          <Users className="h-8 w-8 text-primary" />
        </div>
        <Link
          href="/mwikila"
          className="mt-6 inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-xs font-semibold text-foreground hover:bg-background"
        >
          {isSw ? S.workforceOpenings.openMwikila.sw : S.workforceOpenings.openMwikila.en}
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {isSw ? S.workforceOpenings.openPositions.sw : S.workforceOpenings.openPositions.en}
        </h2>
        <div className="rounded-2xl border border-border bg-surface p-6 text-sm text-muted-foreground">
          {isSw
            ? S.workforceOpenings.emptyPositions.sw
            : S.workforceOpenings.emptyPositions.en}
        </div>
      </section>
    </div>
  );
}
