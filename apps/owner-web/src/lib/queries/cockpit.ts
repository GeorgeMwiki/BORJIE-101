'use client';

import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/api-client';
import type { DailyBriefResponse } from '@/lib/types/cockpit';

export const cockpitKeys = {
  all: ['cockpit'] as const,
  dailyBrief: () => [...cockpitKeys.all, 'daily-brief'] as const,
  cashRunway: () => [...cockpitKeys.all, 'cash-runway'] as const,
  cliffStatus: () => [...cockpitKeys.all, 'cliff-status'] as const,
  licenceHealth: () => [...cockpitKeys.all, 'licence-health'] as const,
  productionVsTarget: () => [...cockpitKeys.all, 'production-vs-target'] as const,
};

/**
 * owner-ceo-1 — defensive guard: coerce any raw API response into a
 * complete DailyBriefResponse so CockpitGrid.tsx never crashes on an
 * undefined property dereference when a slot is missing or the server
 * returned a partial payload.
 *
 * All numeric fields default to 0, all array fields to [], all string
 * fields to '', and all nested objects to their zero shape. The
 * `updatedAt` default is "now" so the timestamp is never blank.
 */
function guardDailyBrief(raw: unknown): DailyBriefResponse {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const toNum = (v: unknown): number =>
    typeof v === 'number' && isFinite(v) ? v : 0;
  // Nullable numeric — preserves an honest `null` (unknown / no-burn runway)
  // rather than collapsing it to 0, which would read as a real "0 days".
  const toNullNum = (v: unknown): number | null =>
    typeof v === 'number' && isFinite(v) ? v : null;
  const toBurnStatus = (v: unknown): 'burning' | 'no_burn' | 'unknown' =>
    v === 'burning' || v === 'no_burn' ? v : 'unknown';
  const toStr = (v: unknown): string =>
    typeof v === 'string' ? v : '';
  const toArr = <T>(v: unknown): ReadonlyArray<T> =>
    Array.isArray(v) ? (v as ReadonlyArray<T>) : [];

  const licences = (typeof r.licences === 'object' && r.licences !== null
    ? r.licences
    : {}) as Record<string, unknown>;
  const production = (typeof r.production === 'object' && r.production !== null
    ? r.production
    : {}) as Record<string, unknown>;
  const compliance = (typeof r.compliance === 'object' && r.compliance !== null
    ? r.compliance
    : {}) as Record<string, unknown>;
  const marketplace = (typeof r.marketplace === 'object' && r.marketplace !== null
    ? r.marketplace
    : {}) as Record<string, unknown>;
  const fxAndGold = (typeof r.fxAndGold === 'object' && r.fxAndGold !== null
    ? r.fxAndGold
    : {}) as Record<string, unknown>;

  return {
    dailyBrief: toArr(r.dailyBrief),
    cashTzsMillions: toNum(r.cashTzsMillions),
    // Preserve honest `null` (unknown / no-burn) — never coerced to 0 days.
    runwayDays: toNullNum(r.runwayDays),
    runwayBurnStatus: toBurnStatus(r.runwayBurnStatus),
    burnPerDayTzsMillions: toNum(r.burnPerDayTzsMillions),
    licences: {
      active: toNum(licences.active),
      renewalsDue60d: toNum(licences.renewalsDue60d),
      dormancyFlags: toNum(licences.dormancyFlags),
    },
    production: {
      grammesToday: toNum(production.grammesToday),
      // Preserve an honest null target (no target feed) — toNum would collapse
      // it to 0, re-fabricating the "0% of target" degenerate KPI.
      grammesTargetToday: toNullNum(production.grammesTargetToday),
      grammesMtd: toNum(production.grammesMtd),
      grammesTargetMtd: toNullNum(production.grammesTargetMtd),
    },
    openRisks: toArr(r.openRisks),
    pendingDecisions: toArr(r.pendingDecisions),
    activeSites: toArr(r.activeSites),
    compliance: {
      green: toNum(compliance.green),
      amber: toNum(compliance.amber),
      red: toNum(compliance.red),
    },
    marketplace: {
      // Preserve the gateway's honest null (marketplace feed not wired) — toNum
      // would collapse it to a fabricated "0 offers" and toStr to "" (empty top
      // buyer) rendered as truth. The card + type are built for the em-dash on
      // null; mirror the runwayDays/grammesTarget null-preservation.
      openOffers: toNullNum(marketplace.openOffers),
      newInquiries7d: toNullNum(marketplace.newInquiries7d),
      topBuyer:
        typeof marketplace.topBuyer === 'string' && marketplace.topBuyer.length > 0
          ? marketplace.topBuyer
          : null,
    },
    fxAndGold: {
      goldSpotUsdOz: toNum(fxAndGold.goldSpotUsdOz),
      tzsUsd: toNum(fxAndGold.tzsUsd),
      sellWindowOpen: Boolean(fxAndGold.sellWindowOpen),
      daysToCliff27Mar: toNum(fxAndGold.daysToCliff27Mar),
    },
    updatedAt: toStr(r.updatedAt) || new Date().toISOString(),
    tenantId: toStr(r.tenantId),
  };
}

/**
 * Stale-while-revalidate fetch for the daily owner brief.
 *
 * Live endpoint: GET /api/v1/mining/cockpit/daily-brief
 * (services/api-gateway/src/routes/mining/cockpit.hono.ts).
 *
 * owner-ceo-1: the queryFn applies `guardDailyBrief` so every card in
 * CockpitGrid receives a fully-shaped object even when the server
 * returns a partial payload. No card will crash on undefined property
 * access; missing slots render honest zero/empty values.
 */
export function useDailyBrief() {
  return useQuery({
    queryKey: cockpitKeys.dailyBrief(),
    queryFn: async ({ signal }) => {
      const raw = await apiRequest<unknown>(
        '/api/v1/mining/cockpit/daily-brief',
        { signal },
      );
      return guardDailyBrief(raw);
    },
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });
}

export interface CashRunwaySummary {
  readonly ninetyDayNetTzs: number;
  readonly dailyAvgTzs: number;
  readonly sampleCount: number;
  readonly note: string;
}

export function useCashRunway() {
  return useQuery({
    queryKey: cockpitKeys.cashRunway(),
    queryFn: ({ signal }) =>
      apiRequest<CashRunwaySummary>(
        '/api/v1/mining/cockpit/cash-runway',
        { signal },
      ),
    staleTime: 60_000,
  });
}

export interface CliffStatusSummary {
  readonly cliffDateIso: string;
  readonly postCliffSales: number;
  readonly usdDenominated: number;
  readonly remediationComplete: boolean;
  readonly note: string;
}

export function useCliffStatus() {
  return useQuery({
    queryKey: cockpitKeys.cliffStatus(),
    queryFn: ({ signal }) =>
      apiRequest<CliffStatusSummary>(
        '/api/v1/mining/cockpit/27mar-cliff-status',
        { signal },
      ),
    staleTime: 5 * 60_000,
  });
}

export interface LicenceHealthRow {
  readonly id: string;
  readonly daysToExpiry: number | null;
  readonly atRisk: boolean;
  readonly dormancyScore?: number;
  readonly kind?: string;
  readonly mineral?: string;
}

export function useLicenceHealth() {
  return useQuery({
    queryKey: cockpitKeys.licenceHealth(),
    queryFn: ({ signal }) =>
      apiRequest<ReadonlyArray<LicenceHealthRow>>(
        '/api/v1/mining/cockpit/licence-health',
        { signal },
      ),
    staleTime: 5 * 60_000,
  });
}

export interface ProductionVsTarget {
  readonly window: string;
  readonly perSite: ReadonlyArray<{
    readonly siteId: string;
    readonly tonnes: number;
    readonly fuel: number;
    readonly shifts: number;
  }>;
}

export function useProductionVsTarget() {
  return useQuery({
    queryKey: cockpitKeys.productionVsTarget(),
    queryFn: ({ signal }) =>
      apiRequest<ProductionVsTarget>(
        '/api/v1/mining/cockpit/production-vs-target',
        { signal },
      ),
    staleTime: 5 * 60_000,
  });
}
