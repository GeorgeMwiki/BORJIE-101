'use client';

/**
 * Client panel for the Mr. Mwikila inbox.
 *
 * GET /api/v1/owner/mwikila-inbox?status=&category= → list
 * POST /api/v1/owner/mwikila-inbox/:id/approve|deny|reverse → action
 *
 * Locale-PURE: every label resolves through `pickByLocale` against the
 * guard-exempt `cockpit-cluster` string table — an `en` session shows
 * zero Swahili and vice versa, never a combined "EN / SW" string. Live
 * reversal-window countdown updates each second.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  Button,
  Badge,
  Alert,
  Skeleton,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  type BadgeProps,
} from '@borjie/design-system';

import { apiRequest } from '@/lib/api-client';
import { useLocale, pickByLocale } from '@/lib/locale';
import { EmptyState as ScreenEmptyState } from '@/components/shared/EmptyState';
import { cockpitClusterStrings as S } from '@/i18n/strings/cockpit-cluster';

interface InboxRow {
  readonly id: string;
  readonly actionKind: string;
  readonly category: string;
  readonly delegationTier: 'T0' | 'T1' | 'T2' | 'T3';
  readonly status:
    | 'proposed'
    | 'owner_approved'
    | 'owner_denied'
    | 'executed'
    | 'reversed'
    | 'committed'
    | 'blocked_by_inviolable'
    | 'expired';
  readonly summary: string;
  readonly summarySw: string;
  readonly rationale: string;
  readonly reversalToken: string | null;
  readonly reversalUntil: string | null;
  readonly executedAt: string | null;
  readonly proposedAt: string;
  readonly blockedReason: string | null;
}

/** Per-status locale label (resolved at render time via pickByLocale). */
const STATUS_LEAF: Record<
  InboxRow['status'],
  { readonly en: string; readonly sw: string }
> = {
  proposed: S.inbox.statusProposed,
  owner_approved: S.inbox.statusApproved,
  owner_denied: S.inbox.statusDenied,
  executed: S.inbox.statusExecuted,
  reversed: S.inbox.statusReversed,
  committed: S.inbox.statusCommitted,
  blocked_by_inviolable: S.inbox.statusBlocked,
  expired: S.inbox.statusExpired,
};

const STATUS_BADGE: Record<InboxRow['status'], BadgeProps['variant']> = {
  proposed: 'info-soft',
  owner_approved: 'success-soft',
  owner_denied: 'secondary',
  executed: 'warning-soft',
  reversed: 'secondary',
  committed: 'success-soft',
  blocked_by_inviolable: 'error-soft',
  expired: 'secondary',
};

const CATEGORIES: ReadonlyArray<InboxRow['category']> = [
  'shifts',
  'payroll-prep',
  'royalty-filing',
  'license-renewal-reminders',
  'contract-followups',
  'worker-hires',
  'worker-discipline',
  'capex',
  'inventory-orders',
  'compliance-filings',
  'marketplace-bids',
  'marketplace-counters',
];

const STATUS_FILTERS: ReadonlyArray<'all' | InboxRow['status']> = [
  'all',
  'proposed',
  'executed',
  'reversed',
  'committed',
  'blocked_by_inviolable',
];

function formatCountdown(
  untilIso: string,
  nowMs: number,
  closedLabel: string,
): string {
  const remainingMs = new Date(untilIso).getTime() - nowMs;
  if (remainingMs <= 0) return closedLabel;
  const hours = Math.floor(remainingMs / 3_600_000);
  const minutes = Math.floor((remainingMs % 3_600_000) / 60_000);
  const seconds = Math.floor((remainingMs % 60_000) / 1_000);
  return `${hours}h ${minutes}m ${seconds}s`;
}

export function MwikilaInboxPanel() {
  const locale = useLocale();
  const [items, setItems] = useState<ReadonlyArray<InboxRow>>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | InboxRow['status']>(
    'all',
  );
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [tick, setTick] = useState<number>(Date.now());

  const allLabel = pickByLocale(locale, S.inbox.all);
  const closedLabel = pickByLocale(locale, S.inbox.windowClosed);

  useEffect(() => {
    const interval = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== 'all') params.set('status', statusFilter);
      if (categoryFilter !== 'all') params.set('category', categoryFilter);
      params.set('limit', '50');
      // apiRequest prepends the gateway base, attaches the Supabase Bearer,
      // and unwraps the {success,data} envelope — so this is the rows array.
      const data = await apiRequest<ReadonlyArray<InboxRow>>(
        `/api/v1/owner/mwikila-inbox?${params.toString()}`,
        { method: 'GET' },
      );
      setItems(data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [statusFilter, categoryFilter]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const runAction = useCallback(
    async (id: string, verb: 'approve' | 'deny' | 'reverse', body?: unknown) => {
      try {
        // apiRequest throws ApiError on non-2xx; its message carries the
        // gateway error body, preserving the prior server-message surface.
        // Always send a JSON body (empty object when none) to match the
        // prior `'{}'` default.
        await apiRequest(`/api/v1/owner/mwikila-inbox/${id}/${verb}`, {
          method: 'POST',
          body: body ?? {},
        });
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [refresh],
  );

  const rowCount = useMemo(() => items.length, [items.length]);

  return (
    <section className="mt-6 space-y-4">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface p-3">
        <span className="text-xs text-muted-foreground">
          {pickByLocale(locale, S.inbox.statusLabel)}:
        </span>
        {STATUS_FILTERS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatusFilter(s)}
            aria-pressed={statusFilter === s}
            className={`rounded px-2 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background ${
              statusFilter === s
                ? 'bg-foreground text-background'
                : 'border border-border text-muted-foreground hover:text-foreground'
            }`}
          >
            {s === 'all' ? allLabel : pickByLocale(locale, STATUS_LEAF[s])}
          </button>
        ))}
        <span className="ml-4 text-xs text-muted-foreground">
          {pickByLocale(locale, S.inbox.categoryLabel)}:
        </span>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="h-8 w-44 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{allLabel}</SelectItem>
            {CATEGORIES.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="ml-auto text-xs text-muted-foreground">
          {pickByLocale(locale, S.inbox.rows(rowCount))}
        </span>
      </div>

      {error ? <Alert variant="error">{error}</Alert> : null}
      {loading ? (
        <ul className="space-y-3" aria-hidden="true">
          {Array.from({ length: 3 }).map((_, i) => (
            <li key={i}>
              <Skeleton className="h-28 rounded-lg border border-border" />
            </li>
          ))}
        </ul>
      ) : items.length === 0 ? (
        <ScreenEmptyState
          title={pickByLocale(locale, S.inbox.emptyTitle)}
          description={pickByLocale(locale, S.inbox.emptyBody)}
        />
      ) : (
        <ul className="space-y-3">
          {items.map((row) => {
            const countdown =
              row.status === 'executed' && row.reversalUntil
                ? formatCountdown(row.reversalUntil, tick, closedLabel)
                : null;
            return (
              <li
                key={row.id}
                className="rounded-lg border border-border bg-surface p-4"
              >
                <header className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <Badge variant="secondary">{row.delegationTier}</Badge>
                  <span className="text-xs text-muted-foreground">
                    {row.category}
                  </span>
                  <Badge variant={STATUS_BADGE[row.status]}>
                    {pickByLocale(locale, STATUS_LEAF[row.status])}
                  </Badge>
                  {countdown ? (
                    <Badge variant="warning-soft" className="ml-auto">
                      {pickByLocale(locale, S.inbox.reversible(countdown))}
                    </Badge>
                  ) : null}
                </header>
                <h3 className="mt-2 text-sm font-medium text-foreground">
                  {pickByLocale(locale, { en: row.summary, sw: row.summarySw })}
                </h3>
                <p className="mt-2 text-xs text-muted-foreground">
                  {row.rationale}
                </p>
                {row.blockedReason ? (
                  <p className="mt-2 rounded bg-danger-subtle p-2 text-xs text-danger">
                    {pickByLocale(
                      locale,
                      S.inbox.blockedByRail(row.blockedReason),
                    )}
                  </p>
                ) : null}
                <div className="mt-3 flex gap-2">
                  {row.status === 'proposed' ? (
                    <>
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => void runAction(row.id, 'approve')}
                      >
                        {pickByLocale(locale, S.inbox.approve)}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => void runAction(row.id, 'deny')}
                      >
                        {pickByLocale(locale, S.inbox.deny)}
                      </Button>
                    </>
                  ) : null}
                  {row.status === 'executed' &&
                  row.reversalToken &&
                  countdown &&
                  countdown !== closedLabel ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        void runAction(row.id, 'reverse', {
                          reversalToken: row.reversalToken,
                        })
                      }
                    >
                      {pickByLocale(locale, S.inbox.reverse)}
                    </Button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
