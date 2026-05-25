import { PageShell } from '@/components/migrated/PageShell';
import { WarehouseClient } from './WarehouseClient';

export default function WarehousePage() {
  return (
    <PageShell
      title="Warehouse"
      subtitle="Maintenance / hardware inventory across the platform — items and stock movements."
    >
      <WarehouseClient />
    </PageShell>
  );
}
