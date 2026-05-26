'use client';

import type { LicenceCockpitData } from '@/lib/types/licence';
import { StatusPill } from '@/components/shared/StatusPill';
import { fmtTzs, fmtDate } from '@/lib/format';

interface PaymentHistoryProps {
  readonly payments: LicenceCockpitData['payments'];
}

const STATUS_TONE: Record<
  LicenceCockpitData['payments'][number]['status'],
  'green' | 'amber' | 'red'
> = {
  paid: 'green',
  due: 'amber',
  overdue: 'red',
};

export function PaymentHistory({ payments }: PaymentHistoryProps) {
  return (
    <article className="rounded-md border border-border bg-surface px-4 py-4">
      <div className="text-xs uppercase tracking-wide text-neutral-500">
        Payment history · obligations vs payments
      </div>
      <table className="mt-3 w-full text-sm">
        <thead>
          <tr className="text-[10px] uppercase tracking-wide text-neutral-500">
            <th className="py-1 text-left">Date</th>
            <th className="py-1 text-left">Description</th>
            <th className="py-1 text-right">Amount</th>
            <th className="py-1 text-right">Status</th>
          </tr>
        </thead>
        <tbody>
          {payments.map((p, idx) => (
            <tr key={idx} className="border-t border-border">
              <td className="py-1.5 text-neutral-300">{fmtDate(p.date)}</td>
              <td className="py-1.5 text-foreground">{p.description}</td>
              <td className="py-1.5 text-right font-mono text-foreground">
                {fmtTzs(p.amountTzs)}
              </td>
              <td className="py-1.5 text-right">
                <StatusPill tone={STATUS_TONE[p.status]} label={p.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </article>
  );
}
