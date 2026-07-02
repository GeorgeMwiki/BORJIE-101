'use client';

/**
 * Payroll "Recent runs" — client island (payroll chain L-B, issue #193).
 *
 * Was a static <EmptyState 'no runs'> that NEVER fetched — committed
 * payroll runs (from GET /api/v1/owner/payroll/runs) were invisible to the
 * owner. This island fetches the runs, mirrors the RosterSurface fetch
 * pattern (react-query + zod parse + apiRequest + ApiError → localizeApiError),
 * and renders a real empty state ONLY when the list is genuinely empty.
 *
 * Client island seeded with `initialLocale` (resolved server-side in
 * page.tsx) so the first paint matches the SSR `<html lang>` chrome and
 * never flashes EN under an SW header (zero-mix canon).
 *
 * Money renders through the cockpit `formatMoney(amount, code, locale)`
 * helper — the ISO-4217 code is DATA (net totals are TZS-denominated by
 * schema: `total_tzs`), never a hardcoded `'TZS '` prefix (CLAUDE.md
 * multi-currency canon).
 */

import { Banknote } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import {
  Alert,
  Badge,
  Skeleton,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@borjie/design-system';
import { localizeApiError } from '@borjie/error-catalog';
import { apiRequest, ApiError } from '@/lib/api-client';
import { EmptyState } from '@/components/shared/EmptyState';
import { useLocale, pickByLocale } from '@/lib/locale';
import { formatMoney, bcp47For, LAUNCH_CURRENCY } from '@/lib/format';
import type { Locale } from '@/lib/locale-shared';
import { routesAStrings as S } from '@/i18n/strings/routes-a';

// ---------------------------------------------------------------------------
// Types — mirror the GET /api/v1/owner/payroll/runs `data` row shape
// (packages/database payroll_runs; numeric columns arrive as strings).
// ---------------------------------------------------------------------------

const PayrollRunSchema = z.object({
  id: z.string(),
  periodStart: z.string(),
  periodEnd: z.string(),
  status: z.string(),
  totalTzs: z.union([z.string(), z.number()]).nullable().optional(),
  workerCount: z.number().nullable().optional(),
  committedAt: z.string().nullable().optional(),
  createdAt: z.string().nullable().optional(),
});

const PayrollRunsResponseSchema = z.object({
  success: z.literal(true),
  data: z.array(PayrollRunSchema),
});

type PayrollRunRow = z.infer<typeof PayrollRunSchema>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtDate(iso: string, locale: Locale): string {
  try {
    return new Date(iso).toLocaleDateString(bcp47For(locale), {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

function statusLabel(status: string, locale: Locale): string {
  switch (status) {
    case 'draft':
      return pickByLocale(locale, S.payroll.statusDraft);
    case 'previewed':
      return pickByLocale(locale, S.payroll.statusPreviewed);
    case 'committed':
      return pickByLocale(locale, S.payroll.statusCommitted);
    case 'partial_commit':
      return pickByLocale(locale, S.payroll.statusPartialCommit);
    case 'paid':
      return pickByLocale(locale, S.payroll.statusPaid);
    case 'failed':
      return pickByLocale(locale, S.payroll.statusFailed);
    default:
      return status;
  }
}

function statusVariant(
  status: string,
): 'success' | 'warning' | 'error' | 'secondary' {
  switch (status) {
    case 'committed':
    case 'paid':
      return 'success';
    case 'partial_commit':
    case 'previewed':
      return 'warning';
    case 'failed':
      return 'error';
    default:
      return 'secondary';
  }
}

function netTotal(row: PayrollRunRow, locale: Locale): string {
  const raw = row.totalTzs;
  const amount = typeof raw === 'string' ? Number(raw) : raw ?? 0;
  return formatMoney(Number.isFinite(amount) ? amount : 0, LAUNCH_CURRENCY, locale);
}

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

function usePayrollRuns() {
  return useQuery({
    queryKey: ['payroll', 'runs'],
    queryFn: ({ signal }) =>
      apiRequest<unknown>('/api/v1/owner/payroll/runs', { signal }),
    select: (raw): ReadonlyArray<PayrollRunRow> => {
      const parsed = PayrollRunsResponseSchema.safeParse(raw);
      return parsed.success ? parsed.data.data : [];
    },
    staleTime: 30_000,
  });
}

// ---------------------------------------------------------------------------
// Island
// ---------------------------------------------------------------------------

interface PayrollRunsListProps {
  readonly initialLocale?: Locale;
}

export function PayrollRunsList({ initialLocale }: PayrollRunsListProps) {
  const locale = useLocale(initialLocale);
  const runsQuery = usePayrollRuns();
  const runs = runsQuery.data ?? [];

  if (runsQuery.isLoading) {
    return <Skeleton className="h-40 rounded-2xl border border-border" />;
  }

  if (runsQuery.isError) {
    return (
      <Alert variant="error">
        {runsQuery.error instanceof ApiError
          ? localizeApiError(runsQuery.error, locale)
          : pickByLocale(locale, S.payroll.runsLoadError)}
      </Alert>
    );
  }

  if (runs.length === 0) {
    return (
      <EmptyState
        icon={<Banknote className="h-6 w-6" />}
        title={pickByLocale(locale, S.payroll.noRunsTitle)}
        description={pickByLocale(locale, S.payroll.noRuns)}
      />
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{pickByLocale(locale, S.payroll.colPeriod)}</TableHead>
          <TableHead>{pickByLocale(locale, S.payroll.colStatus)}</TableHead>
          <TableHead>{pickByLocale(locale, S.payroll.colWorkers)}</TableHead>
          <TableHead>{pickByLocale(locale, S.payroll.colNetTotal)}</TableHead>
          <TableHead>{pickByLocale(locale, S.payroll.colCommitted)}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {runs.map((run) => (
          <TableRow key={run.id}>
            <TableCell className="text-xs text-foreground">
              {fmtDate(run.periodStart, locale)} – {fmtDate(run.periodEnd, locale)}
            </TableCell>
            <TableCell>
              <Badge variant={statusVariant(run.status)}>
                {statusLabel(run.status, locale)}
              </Badge>
            </TableCell>
            <TableCell className="font-mono text-xs text-muted-foreground">
              {run.workerCount ?? 0}
            </TableCell>
            <TableCell className="font-mono text-xs text-foreground">
              {netTotal(run, locale)}
            </TableCell>
            <TableCell className="text-xs text-muted-foreground">
              {run.committedAt
                ? fmtDate(run.committedAt, locale)
                : pickByLocale(locale, S.payroll.notCommitted)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
