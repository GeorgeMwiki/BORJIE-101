import { Card } from '@borjie/design-system';
import { formatCurrency } from '@/lib/api';
import type { Tenant } from '@/lib/internal/types';

interface TenantOverviewTabProps {
  readonly tenant: Tenant;
}

interface Panel {
  readonly title: string;
  readonly value: string;
  readonly hint: string;
}

export function TenantOverviewTab({ tenant }: TenantOverviewTabProps): JSX.Element {
  const panels: ReadonlyArray<Panel> = [
    { title: 'Active operators', value: '4', hint: '2 mine-site · 2 head office' },
    { title: '24h decisions', value: '38', hint: '6 escalated to compliance' },
    { title: 'Open tickets', value: '1', hint: 'SLA: 6h remaining' },
    {
      title: 'ARR',
      value: formatCurrency(tenant.arr, tenant.currency),
      hint: `${tenant.plan} plan`,
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {panels.map((panel) => (
        <Card key={panel.title} className="rounded-2xl p-6 transition-colors hover:border-border-strong">
          <p className="platform-card-title">{panel.title}</p>
          <p className="platform-card-value">{panel.value}</p>
          <p className="text-xs text-neutral-500 mt-1">{panel.hint}</p>
        </Card>
      ))}
    </div>
  );
}
