import Link from 'next/link';
import { ArrowRight, FileCheck, Sparkles } from 'lucide-react';
import { PageHero } from '@/components/shared/PageHero';
import { LicencesList } from '@/components/licences/LicencesList';
import { getOwnerSession } from '@/lib/session';

/**
 * Licences index. Pulls every PML / ML / SML the active tenant holds
 * from `GET /api/v1/mining/licences`, classifies each row by expiry
 * window, and renders a dense filterable table with status pills.
 * Clicking a row routes into the per-licence cockpit drawer at
 * `/licence?id=...`.
 *
 * The hero strip surfaces the Mining Commission renewal CTA so an
 * owner who lands on the index with an expiring licence has the
 * primary action one click away.
 */
export default async function LicencesIndexPage() {
  const session = await getOwnerSession();
  const isSw = session.languagePreference === 'sw';
  return (
    <div className="space-y-8 px-8 py-8">
      <PageHero
        slug="licences"
        actions={
          <>
            <Link
              href="/licence"
              className="inline-flex items-center gap-2 rounded-full bg-signal-500 px-4 py-2 text-xs font-semibold text-background hover:bg-signal-400"
            >
              <FileCheck className="h-3.5 w-3.5" />
              {isSw ? 'Tayarisha pakiti ya kuongeza' : 'Draft renewal pack'}
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
            <Link
              href="/ask?prompt=licences"
              className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-xs font-semibold text-foreground hover:bg-surface"
            >
              <Sparkles className="h-3.5 w-3.5" />
              {isSw ? 'Uliza Akili Kuu' : 'Ask Master Brain'}
            </Link>
          </>
        }
      />
      <LicencesList locale={session.languagePreference} />
    </div>
  );
}
