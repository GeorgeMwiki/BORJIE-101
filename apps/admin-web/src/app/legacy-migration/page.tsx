import { PageShell } from '@/components/migrated/PageShell';
import { LegacyMigrationClient } from './LegacyMigrationClient';

export default function LegacyMigrationPage() {
  return (
    <PageShell
      title="Legacy LPMS migration"
      subtitle="Import data from a legacy LPMS export (CSV / JSON / XML) — preview before commit."
    >
      <LegacyMigrationClient />
    </PageShell>
  );
}
