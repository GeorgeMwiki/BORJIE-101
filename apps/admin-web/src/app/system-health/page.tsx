import { PageShell } from '@/components/migrated/PageShell';
import { SystemHealthClient } from './SystemHealthClient';

export default function SystemHealthPage() {
  return (
    <PageShell
      title="System health"
      subtitle="Live operational gauges across the Borjie runtime — events/sec, LLM latency, daily spend, heartbeat and circuit breakers."
    >
      <SystemHealthClient />
    </PageShell>
  );
}
