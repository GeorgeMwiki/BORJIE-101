'use client';

import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  Skeleton,
  Alert,
} from '@borjie/design-system';
import { formatCurrency } from '@/lib/api';
import { bcp47For } from '@/lib/format';
import { useLocale, pickByLocale, type Locale } from '@/lib/locale';
import {
  useTenantInvoicesQuery,
  type TenantInvoice,
} from '@/lib/internal/queries/tenant-detail';
import type { Tenant } from '@/lib/internal/types';

const S = {
  runRate: { en: 'Annual run rate', sw: 'Kiwango cha kila mwaka' },
  billedMonthly: { en: 'billed monthly', sw: 'inalipwa kila mwezi' },
  colInvoice: { en: 'Invoice', sw: 'Ankara' },
  colIssued: { en: 'Issued', sw: 'Ilitolewa' },
  colAmount: { en: 'Amount', sw: 'Kiasi' },
  colStatus: { en: 'Status', sw: 'Hali' },
  loading: { en: 'Loading invoices…', sw: 'Inapakia ankara…' },
  unavailable: { en: 'Invoices unavailable', sw: 'Ankara hazipatikani' },
  empty: {
    en: 'No invoices for this tenant yet.',
    sw: 'Hakuna ankara kwa mteja huyu bado.',
  },
  // money-core emits a single 'Posted' status (the canonical PLATFORM_FEE
  // ledger leg). There are no charged/paid/overdue states to distinguish.
  statusPosted: { en: 'Posted', sw: 'Imewekwa' },
} as const;

function statusLabel(_status: TenantInvoice['status'], locale: Locale): string {
  return pickByLocale(locale, S.statusPosted);
}

function statusTone(_status: TenantInvoice['status']): string {
  return 'text-success';
}

/**
 * The annual run rate is always-real tenant data. The invoice list is the LIVE
 * per-tenant invoice history from GET /mining/internal/tenants/:id/invoices
 * (PLATFORM_FEE ledger postings) — DS Skeleton while loading, DS Alert on
 * error, honest empty state for an unbilled tenant. No mock rows. Amounts
 * render in each invoice's own currency via `formatCurrency`.
 */
export function TenantBillingTab({
  tenant,
  initialLocale,
}: {
  readonly tenant: Tenant;
  readonly initialLocale?: Locale;
}): JSX.Element {
  const locale = useLocale(initialLocale);
  const { data, isPending, isError, error } = useTenantInvoicesQuery(tenant.id);
  const invoices = data ?? [];

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-surface p-6">
        <div className="flex items-baseline justify-between">
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground">
              {pickByLocale(locale, S.runRate)}
            </p>
            <p className="text-3xl font-display text-foreground tabular-nums">
              {formatCurrency(tenant.arr, tenant.currency, bcp47For(locale))}
            </p>
          </div>
          <p className="text-xs text-muted-foreground">
            {tenant.plan} · {pickByLocale(locale, S.billedMonthly)}
          </p>
        </div>
      </div>

      {isPending ? (
        <Skeleton
          className="h-40 w-full rounded-lg"
          aria-label={pickByLocale(locale, S.loading)}
        />
      ) : isError ? (
        <Alert variant="error" title={pickByLocale(locale, S.unavailable)}>
          {error.message}
        </Alert>
      ) : invoices.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface px-4 py-6">
          <p className="text-xs text-muted-foreground">
            {pickByLocale(locale, S.empty)}
          </p>
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-surface overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{pickByLocale(locale, S.colInvoice)}</TableHead>
                <TableHead>{pickByLocale(locale, S.colIssued)}</TableHead>
                <TableHead className="text-right">
                  {pickByLocale(locale, S.colAmount)}
                </TableHead>
                <TableHead>{pickByLocale(locale, S.colStatus)}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoices.map((inv) => (
                <TableRow key={inv.id}>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {inv.id}
                  </TableCell>
                  <TableCell className="text-muted-foreground tabular-nums">
                    {inv.issuedAt.slice(0, 10)}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground tabular-nums">
                    {formatCurrency(inv.amount, inv.currency, bcp47For(locale))}
                  </TableCell>
                  <TableCell className={`${statusTone(inv.status)} text-xs`}>
                    {statusLabel(inv.status, locale)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
