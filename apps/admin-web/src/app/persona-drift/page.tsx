import { PageShell } from '@/components/migrated/PageShell';
import { PersonaDriftClient } from './PersonaDriftClient';

/**
 * Persona-drift dashboard (Phase D D7).
 *
 * Surfaces the rows from `kernel_persona_drift_events` and renders a
 * chart of dim-breach counts over time. Reads only — alert creation
 * happens via the persona-drift cron supervisor in api-gateway.
 */
export default function PersonaDriftPage() {
  return (
    <PageShell
      title="Persona drift"
      subtitle="Cron-detected voice-consistency breaches across personas. 24-dim probe; per-day rollup."
    >
      <PersonaDriftClient />
    </PageShell>
  );
}
