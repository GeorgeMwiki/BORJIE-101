import { PageShell } from '@/components/migrated/PageShell';
import { DataPrivacyClient } from './DataPrivacyClient';

export default function DataPrivacyPage() {
  return (
    <PageShell
      title="Data privacy"
      subtitle="GDPR right-to-be-forgotten requests, intake and execution."
    >
      <DataPrivacyClient />
    </PageShell>
  );
}
