import Link from 'next/link';
import { AlertTriangle, ShieldCheck } from 'lucide-react';
import { PageHero } from '@/components/shared/PageHero';
import { SafetySurface } from '@/components/safety/SafetySurface';
import { getOwnerSession } from '@/lib/session';

/**
 * O-W-15 — Safety & EHS.
 *
 * Pulls live incidents from `/api/v1/mining/incidents`, renders a
 * 4-up KPI strip (open count, critical, high, closed-30d) plus the
 * dense incident queue and an ICA critical-controls panel for
 * equipment certifications.
 */
export default async function SafetyPage() {
  const session = await getOwnerSession();
  const isSw = session.languagePreference === 'sw';
  return (
    <div className="space-y-8 px-8 py-8">
      <PageHero
        slug="safety"
        actions={
          <>
            <Link
              href="/safety/incidents/new"
              className="inline-flex items-center gap-2 rounded-full bg-signal-500 px-4 py-2 text-xs font-semibold text-background hover:bg-signal-400"
            >
              <AlertTriangle className="h-3.5 w-3.5" />
              {isSw ? 'Sajili tukio jipya' : 'Log new incident'}
            </Link>
            <Link
              href="/ask?prompt=safety"
              className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-xs font-semibold text-foreground hover:bg-surface"
            >
              <ShieldCheck className="h-3.5 w-3.5" />
              {isSw ? 'Toolbox ya leo' : 'Toolbox brief'}
            </Link>
          </>
        }
      />
      <SafetySurface locale={session.languagePreference} />
    </div>
  );
}
