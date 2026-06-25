'use client';

import { Table, TableBody, TableRow, TableCell } from '@borjie/design-system';
import type { PnLRow } from '@/lib/types/finance';
import { formatMoneyMillions, LAUNCH_CURRENCY } from '@/lib/format';
import { useLocale, type Locale } from '@/lib/locale';
import { financeTablesStrings as S } from '@/i18n/strings/finance-tables';

interface PnlTableProps {
  readonly rows: ReadonlyArray<PnLRow>;
  readonly initialLocale?: Locale;
}

export function PnlTable({ rows, initialLocale }: PnlTableProps) {
  const locale = useLocale(initialLocale);
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
      <div className="text-xs uppercase tracking-wide text-muted-foreground">
        {S.pnl.title(LAUNCH_CURRENCY)[locale]}
      </div>
      <Table className="mt-3">
        <TableBody>
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
          <TableRow className="border-t-2 border-border bg-surface/60 hover:bg-surface/60">
            <TableCell className="py-2 font-medium text-foreground">
              {S.pnl.ebitda[locale]}
            </TableCell>
            <TableCell className="py-2 text-right font-mono font-medium text-foreground">
              {money(ebitda)}
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
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
      <TableRow className="bg-surface/40 hover:bg-surface/40">
        <TableCell
          colSpan={2}
          className="py-1 text-tiny uppercase tracking-wide text-muted-foreground"
        >
          {label}
        </TableCell>
      </TableRow>
      {rows.map((r, idx) => (
        <TableRow key={idx}>
          <TableCell className="py-1.5 text-muted-foreground">{r.label}</TableCell>
          <TableCell
            className={`py-1.5 text-right font-mono ${
              r.tzsM < 0 ? 'text-destructive' : 'text-foreground'
            }`}
          >
            {money(r.tzsM)}
          </TableCell>
        </TableRow>
      ))}
      <TableRow className="bg-surface/30 hover:bg-surface/30">
        <TableCell className="py-1 text-badge italic text-muted-foreground">
          {subtotalLabel}
        </TableCell>
        <TableCell className="py-1 text-right font-mono text-badge text-foreground">
          {money(subtotal)}
        </TableCell>
      </TableRow>
    </>
  );
}
