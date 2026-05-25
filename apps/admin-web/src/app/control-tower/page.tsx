import { PageShell } from '@/components/migrated/PageShell';
import { LiveDataRequiredPanel } from '@/components/migrated/LiveDataRequiredPanel';

export default function ControlTowerPage() {
  return (
    <PageShell
      title="Control Tower"
      subtitle="Cross-tenant operations console — live ops view across the platform."
    >
      <LiveDataRequiredPanel
        feature="Control Tower"
        description="Control Tower renders only from the live ops aggregator. The dashboard re-enables once the upstream service is online."
      />
    </PageShell>
  );
}
