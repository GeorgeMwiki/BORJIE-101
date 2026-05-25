import type { Tenant } from '@/lib/mocks/types';

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
      value: new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(
        tenant.arrUsd
      ),
      hint: `${tenant.plan} plan`,
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {panels.map((panel) => (
        <div key={panel.title} className="platform-card">
          <p className="platform-card-title">{panel.title}</p>
          <p className="platform-card-value">{panel.value}</p>
          <p className="text-xs text-neutral-500 mt-1">{panel.hint}</p>
        </div>
      ))}
    </div>
  );
}
