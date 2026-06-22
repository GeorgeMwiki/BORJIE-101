'use client';

import type { LicenceCockpitData } from '@/lib/types/licence';
import { StatusPill } from '@/components/shared/StatusPill';
import { formatMoney, fmtDateForLocale, LAUNCH_CURRENCY } from '@/lib/format';
import { useLocale } from '@/lib/locale';
import { financeTablesStrings as S } from '@/i18n/strings/finance-tables';

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
  const locale = useLocale();
  return (
    <article className="rounded-md border border-border bg-surface px-4 py-4">
      <div className="text-xs uppercase tracking-wide text-neutral-500">
        {S.payments.title[locale]}
      </div>
      <table className="mt-3 w-full text-sm">
        <thead>
          <tr className="text-tiny uppercase tracking-wide text-neutral-500">
            <th className="py-1 text-left">{S.payments.colDate[locale]}</th>
            <th className="py-1 text-left">{S.payments.colDescription[locale]}</th>
            <th className="py-1 text-right">{S.payments.colAmount[locale]}</th>
            <th className="py-1 text-right">{S.payments.colStatus[locale]}</th>
          </tr>
        </thead>
        <tbody>
          {payments.map((p, idx) => (
            <tr key={idx} className="border-t border-border">
              <td className="py-1.5 text-neutral-300">
                {fmtDateForLocale(p.date, locale)}
              </td>
              <td className="py-1.5 text-foreground">{p.description}</td>
              <td className="py-1.5 text-right font-mono text-foreground">
                {formatMoney(p.amountTzs, LAUNCH_CURRENCY, locale)}
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
