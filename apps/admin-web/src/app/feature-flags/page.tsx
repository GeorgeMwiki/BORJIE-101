import { PageShell } from '@/components/migrated/PageShell';
import { FeatureFlagsClient } from './FeatureFlagsClient';

export default function FeatureFlagsPage() {
  return (
    <PageShell
      title="Feature flags"
      subtitle="Resolved server-side flags for the calling staff scope."
    >
      <FeatureFlagsClient />
    </PageShell>
  );
}
