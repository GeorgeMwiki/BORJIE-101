'use client';

/**
 * Workforce openings client island.
 *
 * POST /api/v1/org-admin/openings does not yet exist on the gateway;
 * the creation flow delegates to the brain (Mr. Mwikila). This surface
 * shows an honest empty state until the endpoint lands, with a direct
 * link to Mwikila to post a new opening via the org-admin tools.
 */

import Link from 'next/link';
import { ArrowRight, Briefcase, Sparkles } from 'lucide-react';
import { routesBStrings as S } from '@/i18n/strings/routes-b';

interface WorkforceOpeningsClientProps {
  readonly isSw: boolean;
}

export function WorkforceOpeningsClient({
  isSw,
}: WorkforceOpeningsClientProps) {
  const o = S.workforceOpenings;

  return (
    <div className="space-y-6">
      {/* Post opening via Mwikila card */}
      <section className="rounded-2xl border border-border bg-surface p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-foreground">
              {isSw ? o.postHeading.sw : o.postHeading.en}
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {isSw ? o.postBody.sw : o.postBody.en}
            </p>
          </div>
          <Briefcase className="h-8 w-8 shrink-0 text-signal-500" />
        </div>
        <Link
          href="/mwikila?prompt=post+new+job+opening"
          className="mt-6 inline-flex items-center gap-2 rounded-full bg-signal-500 px-4 py-2 text-xs font-semibold text-background hover:bg-signal-400"
        >
          <Sparkles className="h-3.5 w-3.5" />
          {isSw ? o.openMwikila.sw : o.openMwikila.en}
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </section>

      {/* Open positions list placeholder */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {isSw ? o.openPositions.sw : o.openPositions.en}
        </h2>
        <div className="rounded-2xl border border-border bg-surface/40 p-6 text-center">
          <Briefcase className="mx-auto h-8 w-8 text-neutral-500" />
          <p className="mt-2 text-sm text-muted-foreground">
            {isSw ? o.emptyPositions.sw : o.emptyPositions.en}
          </p>
          <p className="mt-1 font-mono text-tiny uppercase tracking-eyebrow-wide text-neutral-500">
            GET /api/v1/org-admin/openings — not yet available
          </p>
        </div>
      </section>
    </div>
  );
}
