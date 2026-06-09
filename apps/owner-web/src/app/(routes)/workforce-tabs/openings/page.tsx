/**
 * O-W-WORKFORCE-OPENINGS — Workforce openings management.
 *
 * Chain L-A (issue #193): Owner posts job openings; Mr. Mwikila drafts
 * the listing + SMS invite copy. No dedicated GET /openings endpoint
 * exists on the gateway yet — the openings surface delegates to the
 * brain for creation and discovery.
 *
 * The WorkforceOpeningsClient island is 'use client' and handles the
 * interaction. This server component loads the session + provides locale.
 */

import Link from 'next/link';
import { ArrowLeft, Users } from 'lucide-react';
import { getOwnerSession } from '@/lib/session';
import { routesBStrings as S } from '@/i18n/strings/routes-b';
import { WorkforceOpeningsClient } from './WorkforceOpeningsClient';

export default async function WorkforceOpeningsPage() {
  const session = await getOwnerSession();
  const isSw = session.languagePreference === 'sw';
  const o = S.workforceOpenings;

  return (
    <div className="space-y-8 px-8 py-8">
      {/* Back */}
      <div>
        <Link
          href="/workforce-tabs"
          className="inline-flex items-center gap-1.5 text-xs text-neutral-400 hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Workforce
        </Link>
      </div>

      {/* Header */}
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 font-mono text-tiny uppercase tracking-eyebrow-wide text-signal-500">
            <Users className="h-3.5 w-3.5" />
            <span>Workforce · Openings</span>
          </div>
          <h1 className="font-display text-2xl font-medium text-foreground">
            {isSw ? o.title.sw : o.title.en}
          </h1>
          <p className="text-sm text-neutral-400">
            {isSw ? o.intro.sw : o.intro.en}
          </p>
        </div>
      </header>

      <WorkforceOpeningsClient isSw={isSw} />
    </div>
  );
}
