import Link from 'next/link';
import { FileCheck, Sparkles } from 'lucide-react';
import { PageHero } from '@/components/shared/PageHero';
import { ComplianceSurface } from '@/components/compliance/ComplianceSurface';
import { getOwnerSession } from '@/lib/session';

/**
 * O-W-14 — Compliance centre.
 *
 * NEMC + BoT + Mining Commission + TRA + OSHA cadence tracker with
 * green / amber / red status pills and a citations library panel.
 * Lives off the curated regulator set today; swaps to
 * `/api/v1/mining/compliance/checklist` when the gateway exposes it.
 */
export default async function CompliancePage() {
  const session = await getOwnerSession();
  const isSw = session.languagePreference === 'sw';
  return (
    <div className="space-y-8 px-8 py-8">
      <PageHero
        slug="compliance"
        actions={
          <>
            <Link
              href="/compliance/pack"
              className="inline-flex items-center gap-2 rounded-full bg-signal-500 px-4 py-2 text-xs font-semibold text-background hover:bg-signal-400"
            >
              <FileCheck className="h-3.5 w-3.5" />
              {isSw ? 'Tayarisha pakiti' : 'Draft monthly pack'}
            </Link>
            <Link
              href="/ask?prompt=compliance"
              className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-xs font-semibold text-foreground hover:bg-surface"
            >
              <Sparkles className="h-3.5 w-3.5" />
              {isSw ? 'Uliza vidokezo' : 'Ask for citations'}
            </Link>
          </>
        }
      />
      <ComplianceSurface locale={session.languagePreference} />
    </div>
  );
}
