import { ScreenShell } from '@/components/internal/ScreenShell';
import { StubBadge } from '@/components/internal/StubBadge';
import { findScreen } from '@/lib/internal/screens';
import { MOCK_TENANTS } from '@/lib/internal/mock-data';

const SCREEN = findScreen('tenants/detail')!;
const TENANT = MOCK_TENANTS[1]; // Geita Dhahabu Mines

const OPS_PANELS: ReadonlyArray<{ readonly title: string; readonly value: string; readonly hint: string }> = [
  { title: 'Active operators', value: '4', hint: '2 mine-site · 2 head office' },
  { title: '24h decisions', value: '38', hint: '6 escalated to compliance' },
  { title: 'Open tickets', value: '1', hint: 'SLA: 6h remaining' },
  { title: 'Model spend (mo)', value: '$182.40', hint: 'Of $400 plan cap' },
];

export default function TenantDetailPage(): JSX.Element {
  return (
    <ScreenShell
      screen={SCREEN}
      actions={
        <>
          <StubBadge tone="info">Audited impersonation</StubBadge>
          <button
            type="button"
            className="rounded-md border border-warning/40 bg-warning/10 px-3 py-1.5 text-xs font-medium text-warning hover:bg-warning/20"
          >
            Impersonate operator
          </button>
        </>
      }
    >
      <div className="rounded-lg border border-border bg-surface p-6">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-xl font-display text-foreground">{TENANT.name}</h2>
            <p className="text-sm text-neutral-400">
              {TENANT.commodity} · {TENANT.region} · {TENANT.plan} plan
            </p>
          </div>
          <StubBadge tone="success">{TENANT.status}</StubBadge>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {OPS_PANELS.map((panel) => (
          <div key={panel.title} className="platform-card">
            <p className="platform-card-title">{panel.title}</p>
            <p className="platform-card-value">{panel.value}</p>
            <p className="text-xs text-neutral-500 mt-1">{panel.hint}</p>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-border bg-surface p-6">
        <h3 className="text-sm font-medium text-foreground mb-3">Live junior activity</h3>
        <ul className="space-y-2 text-sm">
          <li className="flex justify-between text-neutral-300">
            <span>Geology — drafting assay report for Pit 4</span>
            <span className="text-xs text-neutral-500">12s ago</span>
          </li>
          <li className="flex justify-between text-neutral-300">
            <span>Compliance — checking NEMC renewal status</span>
            <span className="text-xs text-neutral-500">1m ago</span>
          </li>
          <li className="flex justify-between text-neutral-300">
            <span>Sales — matching buyer for 18kg gold dore</span>
            <span className="text-xs text-neutral-500">4m ago</span>
          </li>
        </ul>
      </div>
    </ScreenShell>
  );
}
