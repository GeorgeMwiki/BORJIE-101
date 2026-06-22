import { PageShell } from '@/components/migrated/PageShell';
import { readLocaleFromServerCookies } from '@/lib/locale.server';
import { RegulatorRequestsClient } from './RegulatorRequestsClient';

/**
 * Admin → Regulator → Requests (issue #194 chain C-A).
 *
 * Lists every regulator data-subject request the admin team has
 * captured, with status pills, SLA countdown, and the export +
 * deliver actions. Owner cockpit pulses on every new row via the
 * cockpit-events bus.
 */
export default async function RegulatorRequestsPage() {
  // Seed the client locale from the server-resolved cookie so the first
  // paint matches the SSR'd chrome (no EN-under-SW split-brain frame).
  const initialLocale = await readLocaleFromServerCookies();
  return (
    <PageShell
      title="Regulator requests"
      subtitle="PCCB / NEMC / EITI / TMAA data-subject + audit requests inbox"
    >
      <RegulatorRequestsClient initialLocale={initialLocale} />
    </PageShell>
  );
}
