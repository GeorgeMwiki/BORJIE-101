import { CalendarClock } from 'lucide-react';
import { ShiftPlannerPanel } from '@/components/people/ShiftPlannerPanel';
import { getOwnerSession } from '@/lib/session';
import { shiftPlannerPageStrings as M } from '@/i18n/strings/shift-planner-page';

/**
 * People → Shift Planner.
 *
 * OSHA-TZ-aware 24h shift planner backed by the pure-compute
 * `@borjie/mining-shift-planner` package via
 * `/api/v1/mining/shift-planner/*`. Projects the tenant's REAL
 * employees / assets / sites into a planner-ready roster, then solves a
 * cert/equipment/fatigue-constrained plan with a full OSHA-TZ compliance
 * report as the evidence behind every assignment.
 *
 * Self-contained header (no shared screen-registry slug) so this route
 * stands alone without touching the shared `screens.ts` catalogue.
 */
export default async function ShiftPlannerPage() {
  const session = await getOwnerSession();
  const isSw = session.languagePreference === 'sw';

  return (
    <div className="space-y-8 px-8 py-8">
      <header className="border-b border-border pb-6">
        <div className="flex flex-wrap items-center gap-2 font-mono text-tiny uppercase tracking-eyebrow-wide text-signal-500">
          <CalendarClock className="h-3.5 w-3.5" />
          <span>{isSw ? M.eyebrow.sw : M.eyebrow.en}</span>
        </div>
        <h1 className="mt-3 font-display text-3xl font-medium tracking-tight text-foreground sm:text-4xl">
          {isSw ? M.title.sw : M.title.en}
        </h1>
        <p className="mt-1 text-sm italic text-neutral-500">
          {isSw ? M.subtitle.sw : M.subtitle.en}
        </p>
        <p className="mt-4 max-w-2xl text-sm leading-relaxed text-neutral-300">
          {isSw ? M.body.sw : M.body.en}
        </p>
      </header>

      <ShiftPlannerPanel locale={session.languagePreference} />
    </div>
  );
}
