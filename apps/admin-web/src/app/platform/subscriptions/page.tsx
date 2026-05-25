import { PageShell } from '@/components/migrated/PageShell';
import { SubscriptionsClient } from './SubscriptionsClient';

export default function PlatformSubscriptionsPage() {
  return (
    <PageShell
      title="Subscriptions"
      subtitle="Every active subscription across the platform — status, MRR, billing cycle."
    >
      <SubscriptionsClient />
    </PageShell>
  );
}
