'use client';

import type { PnLRow } from '@/lib/types/finance';
import { formatMoneyMillions, LAUNCH_CURRENCY } from '@/lib/format';
import { useLocale } from '@/lib/locale';
import { financeTablesStrings as S } from '@/i18n/strings/finance-tables';

interface PnlTableProps {
  readonly rows: ReadonlyArray<PnLRow>;
}

export function PnlTable({ rows }: PnlTableProps) {
  const locale = useLocale();
  const groupLabel: Record<PnLRow['group'], string> = {
    revenue: S.pnl.groupRevenue[locale],
    cogs: S.pnl.groupCogs[locale],
    opex: S.pnl.groupOpex[locale],
    other: S.pnl.groupOther[locale],
  };
  const groups: PnLRow['group'][] = ['revenue', 'cogs', 'opex', 'other'];
  const subtotals = Object.fromEntries(
    groups.map((g) => [
      g,
      rows.filter((r) => r.group === g).reduce((sum, r) => sum + r.tzsM, 0),
    ]),
  ) as Record<PnLRow['group'], number>;
  const ebitda =
    (subtotals.revenue ?? 0) +
    (subtotals.cogs ?? 0) +
    (subtotals.opex ?? 0) +
    (subtotals.other ?? 0);

  const money = (millions: number) =>
    formatMoneyMillions(millions, LAUNCH_CURRENCY);

  return (
    <article className="rounded-md border border-border bg-surface px-4 py-4">
      <div className="text-xs uppercase tracking-wide text-neutral-500">
        {S.pnl.title(LAUNCH_CURRENCY)[locale]}
      </div>
      <table className="mt-3 w-full text-sm">
        <tbody>
          {groups.map((g) => (
            <Group
              key={g}
              label={groupLabel[g]}
              subtotalLabel={S.pnl.subtotal[locale]}
              rows={rows.filter((r) => r.group === g)}
              subtotal={subtotals[g]}
              money={money}
            />
          ))}
          <tr className="border-t-2 border-border bg-surface/60">
            <td className="py-2 font-medium text-foreground">
              {S.pnl.ebitda[locale]}
            </td>
            <td className="py-2 text-right font-mono font-medium text-foreground">
              {money(ebitda)}
            </td>
          </tr>
        </tbody>
      </table>
    </article>
  );
}

function Group({
  label,
  subtotalLabel,
  rows,
  subtotal,
  money,
}: {
  readonly label: string;
  readonly subtotalLabel: string;
  readonly rows: ReadonlyArray<PnLRow>;
  readonly subtotal: number;
  readonly money: (millions: number) => string;
}) {
  if (rows.length === 0) return null;
  return (
    <>
      <tr className="bg-surface/40">
        <td colSpan={2} className="py-1 text-tiny uppercase tracking-wide text-neutral-500">
          {label}
        </td>
      </tr>
      {rows.map((r, idx) => (
        <tr key={idx} className="border-t border-border">
          <td className="py-1.5 text-neutral-300">{r.label}</td>
          <td
            className={`py-1.5 text-right font-mono ${
              r.tzsM < 0 ? 'text-destructive' : 'text-foreground'
            }`}
          >
            {money(r.tzsM)}
          </td>
        </tr>
      ))}
      <tr className="border-t border-border bg-surface/30">
        <td className="py-1 text-badge italic text-neutral-400">{subtotalLabel}</td>
        <td className="py-1 text-right font-mono text-badge text-foreground">
          {money(subtotal)}
        </td>
      </tr>
    </>
  );
}
