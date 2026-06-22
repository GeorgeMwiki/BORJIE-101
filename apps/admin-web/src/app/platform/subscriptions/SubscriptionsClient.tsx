'use client';

/**
 * Platform subscriptions — migrated from
 * apps/admin-portal/src/app/platform/subscriptions/page.tsx.
 *
 *   GET /api/v1/admin/subscriptions
 *
 * Tenant-detail navigation links out to owner-portal. Currency / dates are
 * formatted by the shared lib (no hardcoded symbol).
 *
 * Rendered on design-system primitives + semantic tokens. SINGLE LANGUAGE
 * PER LOCALE (canon): every user-facing string resolves to the active
 * locale via `pickByLocale`. Purely client surface — the hook falls back to
 * the project default and the post-mount effect corrects it.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { requirePublicBaseUrl } from '@/lib/env-guard';
import { useLocale, pickByLocale } from '@/lib/locale';

interface Subscription {
  id: string;
  tenantId: string;
  tenantName: string;
  plan: string;
  status: 'active' | 'trialing' | 'past_due' | 'canceled';
  mrr: number;
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

/**
 * Owner-portal base URL. Tenant-detail pages (/tenants/:id) live in the
 * owner-portal app, not in HQ; admin-web links there externally so HQ staff
 * can deep-link into a tenant's own surface. Resolved through
 * `requirePublicBaseUrl` so production builds without
 * NEXT_PUBLIC_OWNER_PORTAL_URL fail at module load.
 */
const OWNER_PORTAL_BASE = requirePublicBaseUrl(
  'NEXT_PUBLIC_OWNER_PORTAL_URL',
  'http://localhost:3001',
);

export function SubscriptionsClient() {
  const locale = useLocale();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [subscriptions, setSubscriptions] = useState<
    ReadonlyArray<Subscription>
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const ownerPortalBase = useMemo(
    () => OWNER_PORTAL_BASE.replace(/\/$/, ''),
    [],
  );

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
        err instanceof Error ? err.message : pickByLocale(locale, S.loadFailed),
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
    totalMrr: subscriptions
      .filter((s) => s.status === 'active' || s.status === 'past_due')
      .reduce((sum, s) => sum + s.mrr, 0),
  };

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
          value={formatCurrency(stats.totalMrr)}
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
                      {sub.status.replace('_', ' ')}
                    </Badge>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-sm capitalize text-muted-foreground">
                    {sub.billingCycle}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-sm font-medium text-foreground">
                    {formatCurrency(sub.mrr)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                    {formatDate(sub.currentPeriodEnd)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-right">
                    {/*
                     * Tenant-detail (/tenants/:id) lives in owner-portal,
                     * not HQ. Link out via NEXT_PUBLIC_OWNER_PORTAL_URL.
                     */}
                    <a
                      href={`${ownerPortalBase}/tenants/${sub.tenantId}`}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="inline-flex items-center gap-1 text-sm text-signal-500 hover:text-signal-400"
                    >
                      {pickByLocale(locale, S.manage)}
                      <ChevronRight className="h-4 w-4" />
                    </a>
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
