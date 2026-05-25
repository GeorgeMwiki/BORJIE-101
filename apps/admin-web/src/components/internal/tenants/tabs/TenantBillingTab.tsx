import type { Tenant } from '@/lib/mocks/types';

interface Invoice {
  readonly id: string;
  readonly issuedAt: string;
  readonly amountUsd: number;
  readonly status: 'Paid' | 'Open' | 'Overdue';
}

const INVOICES: ReadonlyArray<Invoice> = [
  { id: 'inv_204', issuedAt: '2026-05-01', amountUsd: 4920, status: 'Paid' },
  { id: 'inv_198', issuedAt: '2026-04-01', amountUsd: 4920, status: 'Paid' },
  { id: 'inv_191', issuedAt: '2026-03-01', amountUsd: 4480, status: 'Paid' },
];

export function TenantBillingTab({ tenant }: { readonly tenant: Tenant }): JSX.Element {
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-surface p-6">
        <div className="flex items-baseline justify-between">
          <div>
            <p className="text-xs uppercase tracking-wider text-neutral-500">Annual run rate</p>
            <p className="text-3xl font-display text-foreground tabular-nums">
              ${tenant.arrUsd.toLocaleString()}
            </p>
          </div>
          <p className="text-xs text-neutral-500">{tenant.plan} · billed monthly</p>
        </div>
      </div>
      <div className="rounded-lg border border-border bg-surface">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-surface-sunken">
            <tr className="text-left text-xs uppercase tracking-wider text-neutral-500">
              <th className="px-4 py-3 font-medium">Invoice</th>
              <th className="px-4 py-3 font-medium">Issued</th>
              <th className="px-4 py-3 font-medium text-right">Amount</th>
              <th className="px-4 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {INVOICES.map((inv) => (
              <tr key={inv.id} className="border-b border-border last:border-0">
                <td className="px-4 py-3 font-mono text-xs text-neutral-300">{inv.id}</td>
                <td className="px-4 py-3 text-neutral-300 tabular-nums">{inv.issuedAt}</td>
                <td className="px-4 py-3 text-right text-neutral-300 tabular-nums">
                  ${inv.amountUsd.toLocaleString()}
                </td>
                <td className="px-4 py-3 text-success text-xs">{inv.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
