'use client';

/**
 * Platform subscriptions — migrated from
 * apps/admin-portal/src/app/platform/subscriptions/page.tsx.
 *
 *   GET /api/v1/admin/subscriptions
 *
 * Tenant-detail navigation links to this admin app's internal tenant-detail
 * route (/internal/tenants/:id). Each row's MRR renders in the subscription's
 * own ISO currency, and the Total MRR tile groups per currency (never a
 * blind cross-currency sum) — all via the shared `formatCurrency` (no
 * hardcoded symbol).
 *
 * Rendered on design-system primitives + semantic tokens. SINGLE LANGUAGE
 * PER LOCALE (canon): every user-facing string resolves to the active
 * locale via `pickByLocale`. Purely client surface — the hook falls back to
 * the project default and the post-mount effect corrects it.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Building2, ChevronRight } from 'lucide-react';
import {
  Empty,
  Skeleton,
  Alert,
  Button,
  Card,
  Badge,
  FormField,
  SearchInput,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  type BadgeProps,
} from '@borjie/design-system';
import { api, formatCurrency, formatDate } from '@/lib/api';
import { useLocale, pickByLocale, type Locale } from '@/lib/locale';
import { localizeApiError } from '@borjie/error-catalog';
import { toCatalogError } from '@/lib/api-client';

interface Subscription {
  id: string;
  tenantId: string;
  tenantName: string;
  plan: string;
  status: 'active' | 'trialing' | 'past_due' | 'canceled';
  mrr: number;
  /**
   * ISO-4217 code for `mrr`, carried from the backend `SubscriptionDto`
   * (multi-currency hard rule — never assume USD at render). Each row and
   * the per-currency totals format through this code.
   */
  currency: string;
  billingCycle: 'monthly' | 'annual';
  currentPeriodEnd: string;
  createdAt: string;
}

const S = {
  loadFailed: { en: 'Failed to load subscriptions', sw: 'Imeshindwa kupakia michango' },
  retry: { en: 'Retry', sw: 'Jaribu tena' },
  total: { en: 'Total subscriptions', sw: 'Jumla ya michango' },
  active: { en: 'Active', sw: 'Hai' },
  trialing: { en: 'Trialing', sw: 'Jaribio' },
  pastDue: { en: 'Past due', sw: 'Imechelewa' },
  totalMrr: { en: 'Total MRR', sw: 'Jumla ya MRR' },
  searchTenants: { en: 'Search tenants…', sw: 'Tafuta wateja…' },
  allStatus: { en: 'All status', sw: 'Hali zote' },
  canceled: { en: 'Canceled', sw: 'Imeghairiwa' },
  colTenant: { en: 'Tenant', sw: 'Mteja' },
  colPlan: { en: 'Plan', sw: 'Mpango' },
  colStatus: { en: 'Status', sw: 'Hali' },
  colBilling: { en: 'Billing', sw: 'Ankara' },
  colMrr: { en: 'MRR', sw: 'MRR' },
  colPeriodEnd: { en: 'Period end', sw: 'Mwisho wa kipindi' },
  colActions: { en: 'Actions', sw: 'Vitendo' },
  manage: { en: 'Manage', sw: 'Simamia' },
  emptyTitle: { en: 'No subscriptions', sw: 'Hakuna michango' },
  emptyBody: {
    en: 'No subscriptions match the current filters.',
    sw: 'Hakuna michango inayolingana na vichujio vya sasa.',
  },
} as const;

const STATUS_VARIANT: Record<Subscription['status'], BadgeProps['variant']> = {
  active: 'success-soft',
  trialing: 'info-soft',
  past_due: 'warning-soft',
  canceled: 'error-soft',
};

// Raw billing-status enum tokens must NEVER reach the badge as English (e.g.
// "past due") — they map through this localized label table so the active
// locale governs every status string (zero-mix canon).
const STATUS_LABEL: Record<
  Subscription['status'],
  { readonly en: string; readonly sw: string }
> = {
  active: S.active,
  trialing: S.trialing,
  past_due: S.pastDue,
  canceled: S.canceled,
};

// The billing-cycle enum is likewise localized, not rendered as the raw
// English token via `capitalize`.
const BILLING_CYCLE_LABEL: Record<
  Subscription['billingCycle'],
  { readonly en: string; readonly sw: string }
> = {
  monthly: { en: 'Monthly', sw: 'Kila mwezi' },
  annual: { en: 'Annual', sw: 'Kila mwaka' },
};

// Launch-jurisdiction currency for the EMPTY Total MRR tile only (zero
// subscriptions loaded → no currency context to derive from the data).
// Tanzania is the launch market; matches the `?? 'TZS'` default the tenant
// adapter already uses. Never a USD-by-omission render. As soon as any
// subscription is loaded, its own ISO currency drives the tile instead.
const PLATFORM_LAUNCH_CURRENCY = 'TZS';

// Resolve the Intl BCP-47 tag from the active locale (locale-follows-the-user).
// The shared `formatCurrency` defaults its locale to 'en'; passing the active
// locale's tag keeps the money render in the operator's chosen language —
// never an English-by-omission digit grouping under the sw locale.
function bcp47For(locale: Locale): string {
  return locale === 'sw' ? 'sw-TZ' : 'en-GB';
}

export function SubscriptionsClient({ initialLocale }: { readonly initialLocale?: Locale } = {}) {
  const locale = useLocale(initialLocale);
  const bcp47 = bcp47For(locale);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [subscriptions, setSubscriptions] = useState<
    ReadonlyArray<Subscription>
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res =
        await api.get<ReadonlyArray<Subscription>>('/admin/subscriptions');
      if (res.success) {
        setSubscriptions(res.data ?? []);
      } else {
        setError(res.error ?? pickByLocale(locale, S.loadFailed));
      }
    } catch (err) {
      setError(
        localizeApiError(toCatalogError(err), locale),
      );
    } finally {
      setLoading(false);
    }
  }, [locale]);

  useEffect(() => {
    void load();
  }, [load]);

  const filteredSubscriptions = subscriptions.filter((sub) => {
    const matchesSearch = sub.tenantName
      .toLowerCase()
      .includes(search.toLowerCase());
    const matchesStatus =
      statusFilter === 'all' || sub.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const stats = {
    total: subscriptions.length,
    active: subscriptions.filter((s) => s.status === 'active').length,
    trialing: subscriptions.filter((s) => s.status === 'trialing').length,
    pastDue: subscriptions.filter((s) => s.status === 'past_due').length,
  };

  // Total MRR must NEVER blind-sum across distinct ISO currency codes into one
  // figure (money hard rule). Group the contributing rows per currency; the tile
  // renders one formatted total per currency (a single total when all share one
  // code). Currencies are ordered by descending magnitude for a stable display.
  const mrrByCurrency = subscriptions
    .filter((s) => s.status === 'active' || s.status === 'past_due')
    .reduce<ReadonlyArray<readonly [string, number]>>((acc, s) => {
      // Guard the contributing figure: a malformed / non-numeric `mrr` from the
      // backend must NEVER poison the per-currency total with NaN (which would
      // render as "NaN" through the currency formatter).
      const mrr = Number.isFinite(s.mrr) ? s.mrr : 0;
      const existing = acc.find(([code]) => code === s.currency);
      return existing
        ? acc.map((entry) =>
            entry[0] === s.currency ? [entry[0], entry[1] + mrr] : entry,
          )
        : [...acc, [s.currency, mrr]];
    }, [])
    .slice()
    .sort((a, b) => b[1] - a[1]);

  // When no active/past-due rows contribute MRR, still render an explicit
  // currency — never `formatCurrency(0)` (which silently defaults to USD).
  // Prefer ANY loaded subscription's own ISO currency so the zero reads in the
  // tenant base currency; fall back to the platform launch currency only when
  // there are no subscriptions at all.
  const emptyMrrCurrency =
    subscriptions[0]?.currency ?? PLATFORM_LAUNCH_CURRENCY;

  const totalMrrLabel =
    mrrByCurrency.length === 0
      ? formatCurrency(0, emptyMrrCurrency, bcp47)
      : mrrByCurrency
          .map(([code, amount]) => formatCurrency(amount, code, bcp47))
          .join(' · ');

  return (
    <div className="space-y-6">
      {error && (
        <Alert
          variant="error"
          actions={
            <Button size="sm" variant="outline" onClick={() => void load()}>
              {pickByLocale(locale, S.retry)}
            </Button>
          }
        >
          {error}
        </Alert>
      )}

      {loading && (
        <div className="space-y-3" aria-busy="true" aria-live="polite">
          <Skeleton className="h-28 w-full rounded-lg border border-border" />
          <Skeleton className="h-28 w-full rounded-lg border border-border" />
        </div>
      )}

      <section className="grid grid-cols-2 gap-4 md:grid-cols-5">
        <StatTile
          value={String(stats.total)}
          label={pickByLocale(locale, S.total)}
        />
        <StatTile
          value={String(stats.active)}
          label={pickByLocale(locale, S.active)}
          tone="text-success"
        />
        <StatTile
          value={String(stats.trialing)}
          label={pickByLocale(locale, S.trialing)}
          tone="text-info"
        />
        <StatTile
          value={String(stats.pastDue)}
          label={pickByLocale(locale, S.pastDue)}
          tone="text-warning"
        />
        <StatTile
          value={totalMrrLabel}
          label={pickByLocale(locale, S.totalMrr)}
        />
      </section>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
        <div className="flex-1">
          <SearchInput
            placeholder={pickByLocale(locale, S.searchTenants)}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <FormField label={pickByLocale(locale, S.colStatus)} name="statusFilter">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            aria-label={pickByLocale(locale, S.colStatus)}
            className="h-10 w-full rounded-md border border-border bg-surface-sunken px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="all">{pickByLocale(locale, S.allStatus)}</option>
            <option value="active">{pickByLocale(locale, S.active)}</option>
            <option value="trialing">{pickByLocale(locale, S.trialing)}</option>
            <option value="past_due">{pickByLocale(locale, S.pastDue)}</option>
            <option value="canceled">{pickByLocale(locale, S.canceled)}</option>
          </select>
        </FormField>
      </div>

      {!loading && filteredSubscriptions.length === 0 ? (
        <Empty
          title={pickByLocale(locale, S.emptyTitle)}
          description={pickByLocale(locale, S.emptyBody)}
        />
      ) : (
        <Card variant="outline" padding="none" className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{pickByLocale(locale, S.colTenant)}</TableHead>
                <TableHead>{pickByLocale(locale, S.colPlan)}</TableHead>
                <TableHead>{pickByLocale(locale, S.colStatus)}</TableHead>
                <TableHead>{pickByLocale(locale, S.colBilling)}</TableHead>
                <TableHead>{pickByLocale(locale, S.colMrr)}</TableHead>
                <TableHead>{pickByLocale(locale, S.colPeriodEnd)}</TableHead>
                <TableHead className="text-right">
                  {pickByLocale(locale, S.colActions)}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredSubscriptions.map((sub) => (
                <TableRow key={sub.id}>
                  <TableCell className="whitespace-nowrap">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-signal-500/10">
                        <Building2 className="h-5 w-5 text-signal-500" />
                      </div>
                      <span className="font-medium text-foreground">
                        {sub.tenantName}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-sm text-foreground">
                    {sub.plan}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    <Badge variant={STATUS_VARIANT[sub.status]} size="sm">
                      {pickByLocale(locale, STATUS_LABEL[sub.status])}
                    </Badge>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                    {pickByLocale(locale, BILLING_CYCLE_LABEL[sub.billingCycle])}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-sm font-medium text-foreground">
                    {formatCurrency(sub.mrr, sub.currency, bcp47)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                    {formatDate(sub.currentPeriodEnd, bcp47)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-right">
                    {/*
                     * Tenant-detail lives in THIS admin app at
                     * /internal/tenants/:id (the wired internal console
                     * route). The earlier owner-portal /tenants/:id deep-link
                     * 404'd — HQ staff have no owner-portal session.
                     */}
                    <Link
                      href={`/internal/tenants/${sub.tenantId}`}
                      className="inline-flex items-center gap-1 text-sm text-signal-500 hover:text-signal-400"
                    >
                      {pickByLocale(locale, S.manage)}
                      <ChevronRight className="h-4 w-4" />
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}

function StatTile({
  value,
  label,
  tone,
}: {
  value: string;
  label: string;
  tone?: string;
}) {
  return (
    <Card className="rounded-2xl p-6 transition-colors hover:border-border-strong">
      <p className={`font-display text-2xl ${tone ?? 'text-foreground'}`}>
        {value}
      </p>
      <p className="text-sm text-muted-foreground">{label}</p>
    </Card>
  );
}
