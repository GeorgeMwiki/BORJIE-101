'use client';

/**
 * Owner-facing delegation matrix — 12 categories × 4 tiers.
 *
 * GET  /api/v1/owner/delegation       → effective matrix
 * PATCH /api/v1/owner/delegation      → upsert one (category,tier)
 *
 * Each cell click PATCHes the row server-side and refreshes the matrix.
 * Locale-PURE: row labels + tier descriptions resolve through
 * `pickByLocale` against the guard-exempt string tables — never a
 * combined EN/SW string.
 */

import { useCallback, useEffect, useState } from 'react';

import {
  Alert,
  Skeleton,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@borjie/design-system';

import { apiRequest } from '@/lib/api-client';
import { useLocale, pickByLocale } from '@/lib/locale';
import { routesAStrings as RA } from '@/i18n/strings/routes-a';
import { cockpitClusterStrings as S } from '@/i18n/strings/cockpit-cluster';

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
  { key: 'shifts', ...RA.delegationMatrix.catShifts },
  { key: 'payroll-prep', ...RA.delegationMatrix.catPayrollPrep },
  { key: 'royalty-filing', ...RA.delegationMatrix.catRoyaltyFiling },
  {
    key: 'license-renewal-reminders',
    ...RA.delegationMatrix.catLicenceRenewalReminders,
  },
  { key: 'contract-followups', ...RA.delegationMatrix.catContractFollowups },
  { key: 'worker-hires', ...RA.delegationMatrix.catWorkerHires },
  { key: 'worker-discipline', ...RA.delegationMatrix.catWorkerDiscipline },
  { key: 'capex', ...RA.delegationMatrix.catCapex },
  { key: 'inventory-orders', ...RA.delegationMatrix.catInventoryOrders },
  { key: 'compliance-filings', ...RA.delegationMatrix.catComplianceFilings },
  { key: 'marketplace-bids', ...RA.delegationMatrix.catMarketplaceBids },
  { key: 'marketplace-counters', ...RA.delegationMatrix.catMarketplaceCounters },
];

const TIERS: ReadonlyArray<'T0' | 'T1' | 'T2' | 'T3'> = [
  'T0',
  'T1',
  'T2',
  'T3',
];

const TIER_DESCRIPTION: Record<
  'T0' | 'T1' | 'T2' | 'T3',
  { readonly en: string; readonly sw: string }
> = {
  T0: S.delegationMatrix.tierInformOnly,
  T1: S.delegationMatrix.tierPropose,
  T2: S.delegationMatrix.tierActReversal,
  T3: S.delegationMatrix.tierIrrevocable,
};

export function DelegationMatrix() {
  const locale = useLocale();
  const [matrix, setMatrix] = useState<ReadonlyArray<MatrixEntry>>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // apiRequest prepends the gateway base, attaches the Supabase Bearer,
      // and unwraps the {success,data} envelope — so this is the matrix array.
      const data = await apiRequest<ReadonlyArray<MatrixEntry>>(
        '/api/v1/owner/delegation',
        { method: 'GET' },
      );
      setMatrix(data ?? []);
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
        // apiRequest throws ApiError on non-2xx; its message carries the
        // gateway's error body, preserving the prior server-message surface.
        await apiRequest('/api/v1/owner/delegation', {
          method: 'PATCH',
          body: { category, tier },
        });
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
    <section className="mt-6 space-y-4">
      {error ? <Alert variant="error">{error}</Alert> : null}

      {loading ? (
        <Skeleton className="h-72 rounded-lg border border-border" />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>
                {pickByLocale(locale, S.delegationMatrix.categoryHeader)}
              </TableHead>
              {TIERS.map((t) => (
                <TableHead key={t} className="text-center">
                  <span>{t}</span>
                  <span className="mt-0.5 block text-[10px] font-normal normal-case text-muted-foreground">
                    {pickByLocale(locale, TIER_DESCRIPTION[t])}
                  </span>
                </TableHead>
              ))}
              <TableHead className="text-center">
                {pickByLocale(locale, S.delegationMatrix.sourceHeader)}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {CATEGORIES_DISPLAY.map((cat) => {
              const entry = matrix.find((m) => m.category === cat.key);
              return (
                <TableRow key={cat.key}>
                  <TableCell>
                    <div className="text-foreground">
                      {pickByLocale(locale, { en: cat.en, sw: cat.sw })}
                    </div>
                  </TableCell>
                  {TIERS.map((tier) => {
                    const active = entry?.tier === tier;
                    const busy = saving === `${cat.key}:${tier}`;
                    return (
                      <TableCell key={tier} className="text-center">
                        <button
                          type="button"
                          disabled={busy}
                          aria-pressed={active}
                          onClick={() => void setTier(cat.key, tier)}
                          className={`min-w-[3rem] rounded px-3 py-1.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background ${
                            active
                              ? 'bg-foreground text-background'
                              : 'border border-border text-muted-foreground hover:text-foreground'
                          }`}
                        >
                          {busy ? '…' : tier}
                        </button>
                      </TableCell>
                    );
                  })}
                  <TableCell className="text-center text-xs text-muted-foreground">
                    {entry?.source ?? '—'}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </section>
  );
}
