'use client';

import type { CostLine } from '@/lib/types/site-cockpit';
import { ArrowDown, ArrowRight, ArrowUp } from 'lucide-react';
import {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableRow,
  TableHead,
  TableCell,
} from '@borjie/design-system';
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
      <div className="text-xs uppercase tracking-wide text-muted-foreground">
        {S.cost.title(LAUNCH_CURRENCY)[locale]}
      </div>
      <Table className="mt-3">
        <TableHeader>
          <TableRow>
            <TableHead>{S.cost.colLine[locale]}</TableHead>
            <TableHead className="text-right">
              {S.cost.colPerGramme(LAUNCH_CURRENCY)[locale]}
            </TableHead>
            <TableHead className="text-right">{S.cost.colPercent[locale]}</TableHead>
            <TableHead className="text-right">{S.cost.colTrend[locale]}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {costs.map((c) => {
            const Icon = TREND_ICON[c.trend];
            return (
              <TableRow key={c.category}>
                <TableCell className="text-foreground">
                  {categoryLabel[c.category]}
                </TableCell>
                <TableCell className="text-right font-mono text-foreground">
                  {money(c.tzsPerGramme)}
                </TableCell>
                <TableCell className="text-right text-muted-foreground">
                  {((c.tzsPerGramme / total) * 100).toFixed(0)}%
                </TableCell>
                <TableCell className="text-right">
                  <Icon
                    className={`ml-auto h-3.5 w-3.5 ${
                      c.trend === 'up'
                        ? 'text-danger'
                        : c.trend === 'down'
                          ? 'text-success'
                          : 'text-muted-foreground'
                    }`}
                  />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell className="font-medium text-foreground">
              {S.cost.allInCost[locale]}
            </TableCell>
            <TableCell className="text-right font-mono font-medium text-foreground">
              {money(total)}
            </TableCell>
            <TableCell />
            <TableCell />
          </TableRow>
        </TableFooter>
      </Table>
    </article>
  );
}
