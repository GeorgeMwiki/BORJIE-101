import { PageShell } from '@/components/migrated/PageShell';
import { IntegrationsClient } from './IntegrationsClient';

export default function IntegrationsPage() {
  return (
    <PageShell
      title="API integrations"
      subtitle="Agent certifications gating external access to the platform API."
    >
      <IntegrationsClient />
    </PageShell>
  );
}
