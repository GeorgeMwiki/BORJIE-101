import { PageHero } from '@/components/shared/PageHero';
import { RegulatoryCalendarShell } from '@/components/regulatory-calendar/RegulatoryCalendarShell';

/**
 * O-W-26 — Regulatory calendar.
 *
 * Calendar grid of every regulator deadline (Mining Commission, TRA,
 * NEMC, BoT, BRELA, OSHA, TBS, TCRA, LHRC), color-coded by status
 * (scheduled / drafting / submitted / accepted / rejected / overdue).
 * Live data path:
 *   GET /api/v1/ops/regulatory-filings
 */
export default function RegulatoryCalendarPage() {
  return (
    <>
      <PageHero slug="regulatory-calendar" />
      <div className="mt-8">
        <RegulatoryCalendarShell />
      </div>
    </>
  );
}
