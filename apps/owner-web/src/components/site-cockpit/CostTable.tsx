'use client';

import type { CostLine } from '@/lib/types/site-cockpit';
import { ArrowDown, ArrowRight, ArrowUp } from 'lucide-react';
import { fmtTzs } from '@/lib/format';

interface CostTableProps {
  readonly costs: ReadonlyArray<CostLine>;
}

const TREND_ICON = {
  up: ArrowUp,
  down: ArrowDown,
  flat: ArrowRight,
} as const;

const CATEGORY_LABEL: Record<CostLine['category'], string> = {
  extraction: 'Extraction',
  processing: 'Processing',
  royalty: 'Royalty (6%)',
  treasury: 'Treasury haircut',
  csr: 'CSR',
  overhead: 'Overhead',
};

export function CostTable({ costs }: CostTableProps) {
  const total = costs.reduce((sum, c) => sum + c.tzsPerGramme, 0);
  return (
    <article className="rounded-md border border-border bg-surface px-4 py-4">
      <div className="text-xs uppercase tracking-wide text-neutral-500">
        Unit economics · TZS / g
      </div>
      <table className="mt-3 w-full text-sm">
        <thead>
          <tr className="text-tiny uppercase tracking-wide text-neutral-500">
            <th className="py-1 text-left">Line</th>
            <th className="py-1 text-right">TZS / g</th>
            <th className="py-1 text-right">% of total</th>
            <th className="py-1 text-right">Trend</th>
          </tr>
        </thead>
        <tbody>
          {costs.map((c) => {
            const Icon = TREND_ICON[c.trend];
            return (
              <tr key={c.category} className="border-t border-border">
                <td className="py-1.5 text-foreground">{CATEGORY_LABEL[c.category]}</td>
                <td className="py-1.5 text-right font-mono text-foreground">
                  {fmtTzs(c.tzsPerGramme)}
                </td>
                <td className="py-1.5 text-right text-neutral-400">
                  {((c.tzsPerGramme / total) * 100).toFixed(0)}%
                </td>
                <td className="py-1.5 text-right">
                  <Icon
                    className={`ml-auto h-3.5 w-3.5 ${
                      c.trend === 'up'
                        ? 'text-destructive'
                        : c.trend === 'down'
                          ? 'text-success'
                          : 'text-neutral-500'
                    }`}
                  />
                </td>
              </tr>
            );
          })}
          <tr className="border-t border-border bg-surface/60">
            <td className="py-2 font-medium text-foreground">All-in cost</td>
            <td className="py-2 text-right font-mono font-medium text-foreground">
              {fmtTzs(total)}
            </td>
            <td />
            <td />
          </tr>
        </tbody>
      </table>
    </article>
  );
}
