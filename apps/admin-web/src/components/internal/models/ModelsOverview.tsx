'use client';

/**
 * HQ AI-model spend overview (AD-3) — renders the REAL per-model rollup from
 * the `ai_cost_entries` ledger. No fabricated junior assignments or invented
 * p50 latency; a platform with no LLM calls yet shows an honest empty state.
 *
 * Spend is denominated in USD because that is the currency providers bill the
 * platform in (Anthropic / OpenAI invoices), not a tenant-jurisdiction money
 * render — it is intentionally NOT routed through the tenant currency helper.
 */

import { Cpu } from 'lucide-react';
import {
  Skeleton,
  Alert,
  Empty,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@borjie/design-system';
import { StubBadge } from '@/components/internal/StubBadge';
import { useModelsOverviewQuery } from '@/lib/internal/queries/models';
import { useLocale, pickByLocale, type Locale } from '@/lib/locale';
import { formatNumber, formatDate } from '@/lib/format';
import { localizeApiError } from '@borjie/error-catalog';

const fmtUsd = (n: number, locale: Locale): string =>
  `$${formatNumber(n, locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtInt = (n: number, locale: Locale): string => formatNumber(n, locale);

const fmtWhen = (iso: string | null, locale: Locale): string =>
  iso ? formatDate(iso, locale) : '—';

const S = {
  loading: { en: 'Loading model spend…', sw: 'Inapakia matumizi ya modeli…' },
  emptyTitle: { en: 'No model spend recorded yet', sw: 'Hakuna matumizi ya modeli yaliyorekodiwa bado' },
  emptyBody: {
    en: 'Rows appear here once LLM calls land in the cost ledger.',
    sw: 'Safu huonekana hapa mara miito ya LLM inapoingia katika daftari la gharama.',
  },
  colProvider: { en: 'Provider', sw: 'Mtoa huduma' },
  colModel: { en: 'Model', sw: 'Modeli' },
  colCalls: { en: 'Calls', sw: 'Miito' },
  colIn: { en: 'In tokens', sw: 'Tokeni za ndani' },
  colOut: { en: 'Out tokens', sw: 'Tokeni za nje' },
  colSpend: { en: 'Spend (window)', sw: 'Matumizi (kipindi)' },
  colLast: { en: 'Last used', sw: 'Mwisho kutumika' },
} as const;

export function ModelsOverview({
  initialLocale,
}: {
  readonly initialLocale?: Locale;
} = {}): JSX.Element {
  const locale = useLocale(initialLocale);
  const query = useModelsOverviewQuery();

  if (query.isPending) {
    return (
      <Skeleton
        className="h-64 w-full rounded-lg"
        aria-label={pickByLocale(locale, S.loading)}
      />
    );
  }
  if (query.isError) {
    return <Alert variant="error">{localizeApiError(query.error, locale)}</Alert>;
  }

  const rows = query.data?.rows ?? [];

  if (rows.length === 0) {
    return (
      <Empty
        icon={<Cpu className="h-8 w-8" />}
        title={pickByLocale(locale, S.emptyTitle)}
        description={pickByLocale(locale, S.emptyBody)}
      />
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-surface">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{pickByLocale(locale, S.colProvider)}</TableHead>
            <TableHead>{pickByLocale(locale, S.colModel)}</TableHead>
            <TableHead className="text-right">{pickByLocale(locale, S.colCalls)}</TableHead>
            <TableHead className="text-right">{pickByLocale(locale, S.colIn)}</TableHead>
            <TableHead className="text-right">{pickByLocale(locale, S.colOut)}</TableHead>
            <TableHead className="text-right">{pickByLocale(locale, S.colSpend)}</TableHead>
            <TableHead className="text-right">{pickByLocale(locale, S.colLast)}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={`${row.provider}:${row.model}`}>
              <TableCell>
                <StubBadge tone="neutral">{row.provider}</StubBadge>
              </TableCell>
              <TableCell className="font-mono text-xs text-muted-foreground">
                {row.model}
              </TableCell>
              <TableCell className="text-right tabular-nums text-muted-foreground">
                {fmtInt(row.calls, locale)}
              </TableCell>
              <TableCell className="text-right tabular-nums text-muted-foreground">
                {fmtInt(row.inputTokens, locale)}
              </TableCell>
              <TableCell className="text-right tabular-nums text-muted-foreground">
                {fmtInt(row.outputTokens, locale)}
              </TableCell>
              <TableCell className="text-right tabular-nums text-muted-foreground">
                {fmtUsd(row.costUsd, locale)}
              </TableCell>
              <TableCell className="text-right text-xs text-muted-foreground">
                {fmtWhen(row.lastUsedAt, locale)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
