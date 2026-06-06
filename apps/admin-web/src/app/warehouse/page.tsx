import { PageShell } from '@/components/migrated/PageShell';
import { WarehouseClient } from './WarehouseClient';

export default function WarehousePage() {
  return (
    <PageShell
      title="Ore Stockpiles"
      subtitle="Ore-stockpile inventory across sites, warehouses, and in-transit lots — tonnage, grade, and chain of custody."
    >
      <WarehouseClient />
    </PageShell>
  );
}
