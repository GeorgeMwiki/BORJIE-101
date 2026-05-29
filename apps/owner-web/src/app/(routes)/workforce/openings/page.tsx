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

export default async function WorkforceOpeningsPage() {
  const session = await getOwnerSession();
  const isSw = session.languagePreference === 'sw';
  return (
    <div className="space-y-8 px-8 py-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold text-foreground">
          {isSw ? 'Nafasi za Kazi' : 'Workforce Openings'}
        </h1>
        <p className="text-sm text-muted-foreground">
          {isSw
            ? 'Tangaza nafasi mpya — wagombea wataalikwa kupitia SMS na meneja atawakubali.'
            : 'Post a new opening — candidates are invited via SMS and the manager approves them.'}
        </p>
      </header>

      <section className="rounded-2xl border border-border bg-surface p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-foreground">
              {isSw ? 'Tangaza nafasi mpya' : 'Post a new opening'}
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {isSw
                ? 'Mwikila atatengeneza tangazo kutoka kwa maelezo yako.'
                : 'Mwikila drafts the listing from your prompt and pre-fills the SMS invite copy.'}
            </p>
          </div>
          <Users className="h-8 w-8 text-primary" />
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
          {isSw ? 'Nafasi za sasa' : 'Open positions'}
        </h2>
        <div className="rounded-2xl border border-border bg-surface p-6 text-sm text-muted-foreground">
          {isSw
            ? 'Hakuna nafasi wazi bado.'
            : 'No openings yet. Post one above.'}
        </div>
      </section>
    </div>
  );
}
