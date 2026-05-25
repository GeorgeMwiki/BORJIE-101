import Link from 'next/link';
import { ScreenShell } from '@/components/internal/ScreenShell';
import { StubBadge } from '@/components/internal/StubBadge';
import { findScreen } from '@/lib/internal/screens';
import { MOCK_TENANTS } from '@/lib/internal/mock-data';

const SCREEN = findScreen('tenants')!;

function statusTone(status: string): 'success' | 'warn' | 'danger' | 'neutral' {
  if (status === 'Active') return 'success';
  if (status === 'Trial') return 'neutral';
  if (status === 'Past due') return 'warn';
  return 'danger';
}

export default function TenantDirectoryPage(): JSX.Element {
  return (
    <ScreenShell
      screen={SCREEN}
      actions={
        <button
          type="button"
          className="rounded-md bg-signal-500 px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-signal-500/90"
        >
          New tenant
        </button>
      }
    >
      <div className="rounded-lg border border-border bg-surface overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-surface-sunken">
            <tr className="text-left text-xs uppercase tracking-wider text-neutral-500">
              <th className="px-4 py-3 font-medium">Tenant</th>
              <th className="px-4 py-3 font-medium">Commodity</th>
              <th className="px-4 py-3 font-medium">Region</th>
              <th className="px-4 py-3 font-medium">Plan</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium text-right">MRR (USD)</th>
              <th className="px-4 py-3 font-medium" aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {MOCK_TENANTS.map((tenant) => (
              <tr key={tenant.id} className="border-b border-border last:border-0">
                <td className="px-4 py-3 text-foreground font-medium">{tenant.name}</td>
                <td className="px-4 py-3 text-neutral-300">{tenant.commodity}</td>
                <td className="px-4 py-3 text-neutral-300">{tenant.region}</td>
                <td className="px-4 py-3 text-neutral-300">{tenant.plan}</td>
                <td className="px-4 py-3">
                  <StubBadge tone={statusTone(tenant.status)}>{tenant.status}</StubBadge>
                </td>
                <td className="px-4 py-3 text-right text-neutral-300 tabular-nums">
                  {tenant.mrrUsd.toLocaleString()}
                </td>
                <td className="px-4 py-3 text-right">
                  <Link
                    href="/internal/tenants/detail"
                    className="text-xs text-signal-500 hover:underline"
                  >
                    Open
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ScreenShell>
  );
}
