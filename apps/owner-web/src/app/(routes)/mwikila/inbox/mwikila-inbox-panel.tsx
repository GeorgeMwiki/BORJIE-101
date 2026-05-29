'use client';

/**
 * Client panel for the Mr. Mwikila inbox.
 *
 * GET /api/v1/owner/mwikila-inbox?status=&category= → list
 * POST /api/v1/owner/mwikila-inbox/:id/approve|deny|reverse → action
 *
 * Bilingual sw/en labels. Live reversal-window countdown updates each
 * second.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import { getCsrfHeaders } from '@/lib/csrf';

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

const STATUS_LABEL_SW: Record<InboxRow['status'], string> = {
  proposed: 'Pendekezo',
  owner_approved: 'Imeidhinishwa',
  owner_denied: 'Imekataliwa',
  executed: 'Imefanyika',
  reversed: 'Imerejeshwa',
  committed: 'Imekamilika',
  blocked_by_inviolable: 'Imezuiwa',
  expired: 'Imepitwa',
};

const STATUS_LABEL_EN: Record<InboxRow['status'], string> = {
  proposed: 'Proposed',
  owner_approved: 'Approved',
  owner_denied: 'Denied',
  executed: 'Executed',
  reversed: 'Reversed',
  committed: 'Committed',
  blocked_by_inviolable: 'Blocked by safety rail',
  expired: 'Expired',
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

function formatCountdown(untilIso: string, nowMs: number): string {
  const remainingMs = new Date(untilIso).getTime() - nowMs;
  if (remainingMs <= 0) return 'Window closed';
  const hours = Math.floor(remainingMs / 3_600_000);
  const minutes = Math.floor((remainingMs % 3_600_000) / 60_000);
  const seconds = Math.floor((remainingMs % 60_000) / 1_000);
  return `${hours}h ${minutes}m ${seconds}s`;
}

export function MwikilaInboxPanel() {
  const [items, setItems] = useState<ReadonlyArray<InboxRow>>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | InboxRow['status']>(
    'all',
  );
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [tick, setTick] = useState<number>(Date.now());

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
      const res = await fetch(
        `/api/v1/owner/mwikila-inbox?${params.toString()}`,
        { credentials: 'include' },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as {
        success: boolean;
        data?: ReadonlyArray<InboxRow>;
      };
      setItems(json.data ?? []);
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
        const res = await fetch(`/api/v1/owner/mwikila-inbox/${id}/${verb}`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', ...getCsrfHeaders() },
          body: body ? JSON.stringify(body) : '{}',
        });
        if (!res.ok) {
          const json = (await res.json().catch(() => null)) as {
            error?: { message?: string };
          } | null;
          throw new Error(json?.error?.message ?? `HTTP ${res.status}`);
        }
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [refresh],
  );

  const filteredCount = items.length;
  const filterChips = useMemo(
    () => ({ filteredCount, total: items.length }),
    [filteredCount, items.length],
  );

  return (
    <section className="mt-6 space-y-4">
      <div className="flex flex-wrap gap-2 rounded-lg border border-border bg-surface p-3">
        <span className="text-xs text-neutral-400">Status:</span>
        {STATUS_FILTERS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatusFilter(s)}
            className={`rounded px-2 py-1 text-xs ${
              statusFilter === s
                ? 'bg-foreground text-background'
                : 'border border-border text-neutral-300'
            }`}
          >
            {s === 'all' ? 'All / Zote' : STATUS_LABEL_EN[s]}
          </button>
        ))}
        <span className="ml-4 text-xs text-neutral-400">Category:</span>
        <select
          className="rounded border border-border bg-background px-2 py-1 text-xs text-foreground"
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
        >
          <option value="all">All / Zote</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <span className="ml-auto text-xs text-neutral-500">
          {filterChips.filteredCount} rows
        </span>
      </div>

      {error ? (
        <p className="rounded border border-destructive bg-destructive/5 p-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {loading ? (
        <p className="text-sm text-neutral-400">Loading… / Inapakia…</p>
      ) : items.length === 0 ? (
        <p className="rounded border border-border bg-surface p-4 text-sm text-neutral-400">
          No actions to review yet — Mr. Mwikila stays quiet until there is
          something to act on. / Hakuna shughuli za kukagua bado.
        </p>
      ) : (
        <ul className="space-y-3">
          {items.map((row) => {
            const countdown =
              row.status === 'executed' && row.reversalUntil
                ? formatCountdown(row.reversalUntil, tick)
                : null;
            return (
              <li
                key={row.id}
                className="rounded-lg border border-border bg-surface p-4"
              >
                <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="rounded bg-foreground/10 px-2 py-0.5 text-xs uppercase tracking-wide text-foreground">
                    {row.delegationTier}
                  </span>
                  <span className="text-xs text-neutral-400">
                    {row.category}
                  </span>
                  <span className="text-xs text-neutral-400">
                    {STATUS_LABEL_EN[row.status]} /{' '}
                    {STATUS_LABEL_SW[row.status]}
                  </span>
                  {countdown ? (
                    <span className="ml-auto rounded bg-amber-500/10 px-2 py-0.5 text-xs text-amber-400">
                      Reversible: {countdown}
                    </span>
                  ) : null}
                </header>
                <h3 className="mt-2 text-sm font-medium text-foreground">
                  {row.summary}
                </h3>
                <p className="mt-1 text-xs italic text-neutral-500">
                  {row.summarySw}
                </p>
                <p className="mt-2 text-xs text-neutral-300">{row.rationale}</p>
                {row.blockedReason ? (
                  <p className="mt-2 rounded bg-destructive/5 p-2 text-xs text-destructive">
                    Blocked by inviolable rail: {row.blockedReason}
                  </p>
                ) : null}
                <div className="mt-3 flex gap-2">
                  {row.status === 'proposed' ? (
                    <>
                      <button
                        type="button"
                        onClick={() => void runAction(row.id, 'approve')}
                        className="rounded bg-foreground px-3 py-1 text-xs text-background"
                      >
                        Approve / Idhinisha
                      </button>
                      <button
                        type="button"
                        onClick={() => void runAction(row.id, 'deny')}
                        className="rounded border border-border px-3 py-1 text-xs text-foreground"
                      >
                        Deny / Kataa
                      </button>
                    </>
                  ) : null}
                  {row.status === 'executed' &&
                  row.reversalToken &&
                  countdown &&
                  countdown !== 'Window closed' ? (
                    <button
                      type="button"
                      onClick={() =>
                        void runAction(row.id, 'reverse', {
                          reversalToken: row.reversalToken,
                        })
                      }
                      className="rounded border border-amber-500 px-3 py-1 text-xs text-amber-400"
                    >
                      Reverse / Rejesha
                    </button>
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
