import { ScreenHeader } from '@/components/ScreenHeader';
import { PlaceholderCard } from '@/components/PlaceholderCard';

/**
 * O-W-14 — Compliance centre.
 *
 * Regulator citation library (Mining Act 2010, EMA, TMAA circulars,
 * BoT FX rules) plus a per-obligation action checklist with owner /
 * agent assignment.
 */
export default function CompliancePage() {
  return (
    <>
      <ScreenHeader slug="compliance" />
      <div className="grid grid-cols-1 gap-4 px-8 py-6 md:grid-cols-3">
        <PlaceholderCard title="Citation library">
          Searchable corpus: Mining Act, EMA, TMAA circulars, BoT FX rules,
          local-content regs. Each chunk linked to obligations.
        </PlaceholderCard>
        <PlaceholderCard title="Action checklist">
          Per-obligation: status, due date, owner, evidence package required.
          Filter by urgency.
        </PlaceholderCard>
        <PlaceholderCard title="Regulator interactions">
          Inbound + outbound correspondence log, hash-anchored so an
          inspection can verify what was actually sent.
        </PlaceholderCard>
      </div>
    </>
  );
}
