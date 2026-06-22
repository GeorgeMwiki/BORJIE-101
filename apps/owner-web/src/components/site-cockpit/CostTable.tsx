'use client';

import type { CostLine } from '@/lib/types/site-cockpit';
import { ArrowDown, ArrowRight, ArrowUp } from 'lucide-react';
import { formatMoney, LAUNCH_CURRENCY } from '@/lib/format';
import { useLocale } from '@/lib/locale';
import { financeTablesStrings as S } from '@/i18n/strings/finance-tables';

interface CostTableProps {
  readonly costs: ReadonlyArray<CostLine>;
}

const TREND_ICON = {
  up: ArrowUp,
  down: ArrowDown,
  flat: ArrowRight,
} as const;

export function CostTable({ costs }: CostTableProps) {
  const locale = useLocale();
  const categoryLabel: Record<CostLine['category'], string> = {
    extraction: S.cost.catExtraction[locale],
    processing: S.cost.catProcessing[locale],
    royalty: S.cost.catRoyalty[locale],
    treasury: S.cost.catTreasury[locale],
    csr: S.cost.catCsr[locale],
    overhead: S.cost.catOverhead[locale],
  };
  const total = costs.reduce((sum, c) => sum + c.tzsPerGramme, 0);
  const money = (value: number) => formatMoney(value, LAUNCH_CURRENCY, locale);
  return (
    <article className="rounded-md border border-border bg-surface px-4 py-4">
      <div className="text-xs uppercase tracking-wide text-neutral-500">
        {S.cost.title(LAUNCH_CURRENCY)[locale]}
      </div>
      <table className="mt-3 w-full text-sm">
        <thead>
          <tr className="text-tiny uppercase tracking-wide text-neutral-500">
            <th className="py-1 text-left">{S.cost.colLine[locale]}</th>
            <th className="py-1 text-right">
              {S.cost.colPerGramme(LAUNCH_CURRENCY)[locale]}
            </th>
            <th className="py-1 text-right">{S.cost.colPercent[locale]}</th>
            <th className="py-1 text-right">{S.cost.colTrend[locale]}</th>
          </tr>
        </thead>
        <tbody>
          {costs.map((c) => {
            const Icon = TREND_ICON[c.trend];
            return (
              <tr key={c.category} className="border-t border-border">
                <td className="py-1.5 text-foreground">{categoryLabel[c.category]}</td>
                <td className="py-1.5 text-right font-mono text-foreground">
                  {money(c.tzsPerGramme)}
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
            <td className="py-2 font-medium text-foreground">
              {S.cost.allInCost[locale]}
            </td>
            <td className="py-2 text-right font-mono font-medium text-foreground">
              {money(total)}
            </td>
            <td />
            <td />
          </tr>
        </tbody>
      </table>
    </article>
  );
}
