import { PageShell } from '@/components/migrated/PageShell';
import { WebhookDLQClient } from './WebhookDLQClient';

export default function WebhookDLQPage() {
  return (
    <PageShell
      title="Webhook DLQ"
      subtitle="Outbound webhook dead-letter queue — inspect and replay failed deliveries."
    >
      <WebhookDLQClient />
    </PageShell>
  );
}
