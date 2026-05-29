import { PageShell } from '@/components/migrated/PageShell';
import { RegulatorRequestsClient } from './RegulatorRequestsClient';

/**
 * Admin → Regulator → Requests (issue #194 chain C-A).
 *
 * Lists every regulator data-subject request the admin team has
 * captured, with status pills, SLA countdown, and the export +
 * deliver actions. Owner cockpit pulses on every new row via the
 * cockpit-events bus.
 */
export default function RegulatorRequestsPage() {
  return (
    <PageShell
      title="Regulator requests"
      subtitle="PCCB / NEMC / EITI / TMAA data-subject + audit requests inbox"
    >
      <RegulatorRequestsClient />
    </PageShell>
  );
}
