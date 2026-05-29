'use client';

/**
 * Owner-facing delegation matrix — 12 categories × 4 tiers.
 *
 * GET  /api/v1/owner/delegation       → effective matrix
 * PATCH /api/v1/owner/delegation      → upsert one (category,tier)
 *
 * Each cell click PATCHes the row server-side and refreshes the
 * matrix. Bilingual sw/en row labels.
 */

import { useCallback, useEffect, useState } from 'react';

import { getCsrfHeaders } from '@/lib/csrf';

interface MatrixEntry {
  readonly category: string;
  readonly tier: 'T0' | 'T1' | 'T2' | 'T3';
  readonly reversalWindowHours: number;
  readonly envelopeThresholdTzs: number | null;
  readonly source: 'owner' | 'default';
}

const CATEGORIES_DISPLAY: ReadonlyArray<{
  readonly key: string;
  readonly en: string;
  readonly sw: string;
}> = [
  { key: 'shifts', en: 'Shifts', sw: 'Zamu' },
  { key: 'payroll-prep', en: 'Payroll prep', sw: 'Maandalizi ya mishahara' },
  { key: 'royalty-filing', en: 'Royalty filing', sw: 'Ufungaji wa mrabaha' },
  {
    key: 'license-renewal-reminders',
    en: 'License renewal reminders',
    sw: 'Vikumbusho vya leseni',
  },
  {
    key: 'contract-followups',
    en: 'Contract followups',
    sw: 'Ufuatiliaji wa mikataba',
  },
  { key: 'worker-hires', en: 'Worker hires', sw: 'Kuajiri wafanyakazi' },
  {
    key: 'worker-discipline',
    en: 'Worker discipline',
    sw: 'Hatua za kinidhamu',
  },
  { key: 'capex', en: 'Capex', sw: 'Matumizi makubwa' },
  { key: 'inventory-orders', en: 'Inventory orders', sw: 'Maagizo ya bidhaa' },
  {
    key: 'compliance-filings',
    en: 'Compliance filings',
    sw: 'Ripoti za kanuni',
  },
  { key: 'marketplace-bids', en: 'Marketplace bids', sw: 'Zabuni za soko' },
  {
    key: 'marketplace-counters',
    en: 'Marketplace counters',
    sw: 'Rejea za bei',
  },
];

const TIERS: ReadonlyArray<'T0' | 'T1' | 'T2' | 'T3'> = [
  'T0',
  'T1',
  'T2',
  'T3',
];

const TIER_DESCRIPTION_EN: Record<'T0' | 'T1' | 'T2' | 'T3', string> = {
  T0: 'Inform only',
  T1: 'Propose',
  T2: 'Act + reversal',
  T3: 'Irrevocable',
};

export function DelegationMatrix() {
  const [matrix, setMatrix] = useState<ReadonlyArray<MatrixEntry>>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/owner/delegation', {
        credentials: 'include',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as {
        success: boolean;
        data?: ReadonlyArray<MatrixEntry>;
      };
      setMatrix(json.data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const setTier = useCallback(
    async (category: string, tier: 'T0' | 'T1' | 'T2' | 'T3') => {
      setSaving(`${category}:${tier}`);
      setError(null);
      try {
        const res = await fetch('/api/v1/owner/delegation', {
          method: 'PATCH',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            ...getCsrfHeaders(),
          },
          body: JSON.stringify({ category, tier }),
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
      } finally {
        setSaving(null);
      }
    },
    [refresh],
  );

  return (
    <section className="mt-6">
      {error ? (
        <p className="mb-4 rounded border border-destructive bg-destructive/5 p-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className="text-sm text-neutral-400">Loading… / Inapakia…</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase text-neutral-400">
                <th className="px-4 py-3">Category / Kazi</th>
                {TIERS.map((t) => (
                  <th key={t} className="px-3 py-3 text-center">
                    {t}
                    <div className="text-[10px] normal-case text-neutral-500">
                      {TIER_DESCRIPTION_EN[t]}
                    </div>
                  </th>
                ))}
                <th className="px-3 py-3 text-center">Source</th>
              </tr>
            </thead>
            <tbody>
              {CATEGORIES_DISPLAY.map((cat) => {
                const entry = matrix.find((m) => m.category === cat.key);
                return (
                  <tr
                    key={cat.key}
                    className="border-b border-border/50 last:border-b-0"
                  >
                    <td className="px-4 py-3">
                      <div className="text-foreground">{cat.en}</div>
                      <div className="text-xs italic text-neutral-500">
                        {cat.sw}
                      </div>
                    </td>
                    {TIERS.map((tier) => {
                      const active = entry?.tier === tier;
                      const busy = saving === `${cat.key}:${tier}`;
                      return (
                        <td
                          key={tier}
                          className="px-3 py-3 text-center"
                        >
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void setTier(cat.key, tier)}
                            className={`min-w-[3rem] rounded px-3 py-1.5 text-xs ${
                              active
                                ? 'bg-foreground text-background'
                                : 'border border-border text-neutral-400 hover:text-foreground'
                            }`}
                          >
                            {busy ? '…' : tier}
                          </button>
                        </td>
                      );
                    })}
                    <td className="px-3 py-3 text-center text-xs text-neutral-500">
                      {entry?.source ?? '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
