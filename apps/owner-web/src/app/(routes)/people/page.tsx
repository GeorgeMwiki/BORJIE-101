import Link from 'next/link';
import { Sparkles, Users } from 'lucide-react';
import { PageHero } from '@/components/shared/PageHero';
import { PeopleSurface } from '@/components/people/PeopleSurface';
import { getOwnerSession } from '@/lib/session';
import { SW } from '@/lib/sw-tokens';

/**
 * O-W-08 — People & roles.
 *
 * Workforce KPI strip (on-shift count, supervisor coverage, open
 * incidents, fuel trend) plus supervisor list, incident feed, and a
 * fuel-consumption sparkline. Hooks
 * `/api/v1/mining/attendance/headcount` and
 * `/api/v1/mining/incidents` for live numbers.
 */
export default async function PeoplePage() {
  const session = await getOwnerSession();
  const isSw = session.languagePreference === 'sw';
  return (
    <div className="space-y-8 px-8 py-8">
      <PageHero
        slug="people"
        actions={
          <>
            <Link
              href="/people/roster"
              className="inline-flex items-center gap-2 rounded-full bg-signal-500 px-4 py-2 text-xs font-semibold text-background hover:bg-signal-400"
            >
              <Users className="h-3.5 w-3.5" />
              {isSw ? 'Onyesha ratiba' : 'Open roster'}
            </Link>
            <Link
              href="/ask?prompt=people"
              className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-xs font-semibold text-foreground hover:bg-surface"
            >
              <Sparkles className="h-3.5 w-3.5" />
              {isSw ? `Uliza kuhusu ${SW.workforce}` : 'Ask about workforce'}
            </Link>
          </>
        }
      />
      <PeopleSurface locale={session.languagePreference} />
    </div>
  );
}
