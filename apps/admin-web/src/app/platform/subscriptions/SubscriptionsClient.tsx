'use client';

/**
 * Platform subscriptions — migrated from
 * apps/admin-portal/src/app/platform/subscriptions/page.tsx.
 *
 *   GET /api/v1/admin/subscriptions
 *
 * Tenant-detail navigation now uses next/link. Currency / dates are
 * formatted by the shared lib.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Building2, Search, ChevronRight } from 'lucide-react';
import {
  EmptyState,
  Skeleton,
  Alert,
  AlertDescription,
  Button,
} from '@borjie/design-system';
import { api, formatCurrency, formatDate } from '@/lib/api';
import { requirePublicBaseUrl } from '@/lib/env-guard';

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

const statusColors: Record<string, string> = {
  active: 'bg-emerald-500/15 text-emerald-300',
  trialing: 'bg-blue-500/15 text-blue-300',
  past_due: 'bg-amber-500/15 text-amber-300',
  canceled: 'bg-rose-500/15 text-rose-300',
};

/**
 * Owner-portal base URL. Tenant-detail pages (/tenants/:id) live in the
 * owner-portal app, not in HQ; admin-web links there
 * externally so HQ staff can deep-link into a tenant's own surface.
 *
 * Resolved through `requirePublicBaseUrl` so production builds without
 * NEXT_PUBLIC_OWNER_PORTAL_URL fail at module load instead of silently
 * pointing HQ staff at localhost:3001 from a deployed bundle.
 */
const OWNER_PORTAL_BASE = requirePublicBaseUrl(
  'NEXT_PUBLIC_OWNER_PORTAL_URL',
  'http://localhost:3001',
);

export function SubscriptionsClient() {
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
        setError(res.error ?? 'Failed to load subscriptions');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load subscriptions');
    } finally {
      setLoading(false);
    }
  }, []);

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
        <Alert variant="danger">
          <AlertDescription>
            {error}
            <Button
              size="sm"
              variant="link"
              onClick={() => void load()}
              className="ml-2"
            >
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {loading && (
        <div className="space-y-3" aria-busy="true" aria-live="polite">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      )}

      <section className="grid grid-cols-2 gap-4 md:grid-cols-5">
        <StatTile value={String(stats.total)} label="Total subscriptions" />
        <StatTile
          value={String(stats.active)}
          label="Active"
          tone="text-emerald-400"
        />
        <StatTile
          value={String(stats.trialing)}
          label="Trialing"
          tone="text-blue-400"
        />
        <StatTile
          value={String(stats.pastDue)}
          label="Past due"
          tone="text-amber-400"
        />
        <StatTile
          value={formatCurrency(stats.totalMrr)}
          label="Total MRR"
        />
      </section>

      <div className="flex flex-col gap-4 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-500" />
          <input
            type="text"
            placeholder="Search tenants…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-border bg-surface-sunken py-2 pl-10 pr-4 text-sm text-foreground focus:border-signal-500 focus:outline-none focus:ring-2 focus:ring-signal-500"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-lg border border-border bg-surface-sunken px-4 py-2 text-sm text-foreground focus:border-signal-500 focus:outline-none focus:ring-2 focus:ring-signal-500"
        >
          <option value="all">All status</option>
          <option value="active">Active</option>
          <option value="trialing">Trialing</option>
          <option value="past_due">Past due</option>
          <option value="canceled">Canceled</option>
        </select>
      </div>

      <div className="platform-card overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border/40 text-left text-xs uppercase tracking-wider text-neutral-500">
              <th className="px-6 py-3">Tenant</th>
              <th className="px-6 py-3">Plan</th>
              <th className="px-6 py-3">Status</th>
              <th className="px-6 py-3">Billing</th>
              <th className="px-6 py-3">MRR</th>
              <th className="px-6 py-3">Period end</th>
              <th className="px-6 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/40">
            {filteredSubscriptions.map((sub) => (
              <tr key={sub.id} className="hover:bg-surface">
                <td className="whitespace-nowrap px-6 py-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-signal-500/10">
                      <Building2 className="h-5 w-5 text-signal-500" />
                    </div>
                    <span className="font-medium text-foreground">
                      {sub.tenantName}
                    </span>
                  </div>
                </td>
                <td className="whitespace-nowrap px-6 py-4 text-sm text-neutral-200">
                  {sub.plan}
                </td>
                <td className="whitespace-nowrap px-6 py-4">
                  <span
                    className={`rounded-full px-2 py-1 text-xs font-medium ${
                      statusColors[sub.status] ?? statusColors.active
                    }`}
                  >
                    {sub.status.replace('_', ' ')}
                  </span>
                </td>
                <td className="whitespace-nowrap px-6 py-4 text-sm text-neutral-400">
                  <span className="capitalize">{sub.billingCycle}</span>
                </td>
                <td className="whitespace-nowrap px-6 py-4 text-sm font-medium text-foreground">
                  {formatCurrency(sub.mrr)}
                </td>
                <td className="whitespace-nowrap px-6 py-4 text-sm text-neutral-400">
                  {formatDate(sub.currentPeriodEnd)}
                </td>
                <td className="whitespace-nowrap px-6 py-4 text-right">
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
                    Manage
                    <ChevronRight className="h-4 w-4" />
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!loading && filteredSubscriptions.length === 0 && (
        <EmptyState
          icon={<Building2 className="h-8 w-8" />}
          title="No subscriptions"
          description="No subscriptions match the current filters."
        />
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
    <div className="platform-card">
      <p className={`text-2xl font-display ${tone ?? 'text-foreground'}`}>
        {value}
      </p>
      <p className="text-sm text-neutral-400">{label}</p>
    </div>
  );
}
