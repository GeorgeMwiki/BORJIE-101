'use client';

import type { PnLRow } from '@/lib/types/finance';
import { fmtTzsM } from '@/lib/format';

interface PnlTableProps {
  readonly rows: ReadonlyArray<PnLRow>;
}

const GROUP_LABEL: Record<PnLRow['group'], string> = {
  revenue: 'Revenue',
  cogs: 'Cost of sales',
  opex: 'Operating expense',
  other: 'Other',
};

export function PnlTable({ rows }: PnlTableProps) {
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

  return (
    <article className="rounded-md border border-border bg-surface px-4 py-4">
      <div className="text-xs uppercase tracking-wide text-neutral-500">
        Monthly P&L · TZS millions
      </div>
      <table className="mt-3 w-full text-sm">
        <tbody>
          {groups.map((g) => (
            <Group key={g} group={g} rows={rows.filter((r) => r.group === g)} subtotal={subtotals[g]} />
          ))}
          <tr className="border-t-2 border-border bg-surface/60">
            <td className="py-2 font-medium text-foreground">EBITDA</td>
            <td className="py-2 text-right font-mono font-medium text-foreground">
              {fmtTzsM(ebitda)}
            </td>
          </tr>
        </tbody>
      </table>
    </article>
  );
}

function Group({
  group,
  rows,
  subtotal,
}: {
  readonly group: PnLRow['group'];
  readonly rows: ReadonlyArray<PnLRow>;
  readonly subtotal: number;
}) {
  if (rows.length === 0) return null;
  return (
    <>
      <tr className="bg-surface/40">
        <td colSpan={2} className="py-1 text-tiny uppercase tracking-wide text-neutral-500">
          {GROUP_LABEL[group]}
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
            {fmtTzsM(r.tzsM)}
          </td>
        </tr>
      ))}
      <tr className="border-t border-border bg-surface/30">
        <td className="py-1 text-badge italic text-neutral-400">subtotal</td>
        <td className="py-1 text-right font-mono text-badge text-foreground">
          {fmtTzsM(subtotal)}
        </td>
      </tr>
    </>
  );
}
