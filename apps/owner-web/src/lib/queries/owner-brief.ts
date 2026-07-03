'use client';

import { useQuery } from '@tanstack/react-query';
import { apiRequest, ApiError, LLM_REQUEST_TIMEOUT_MS } from '@/lib/api-client';

/**
 * react-query bindings for `GET /api/v1/owner/brief` — the seven-slot
 * unified dashboard composition endpoint described in
 * `services/api-gateway/src/routes/owner/brief.hono.ts`.
 *
 * The wire shape mirrors `OwnerBriefSchema` from the gateway. If the
 * unified endpoint is unavailable (503), callers can fall back to the
 * six cockpit slot endpoints (already exposed under
 * `/api/v1/mining/cockpit/*`) via `useCockpitDailyBrief()` etc. on the
 * existing `queries/cockpit.ts` hooks.
 */

export interface DailyBriefSlot {
  readonly date: string;
  readonly shiftsToday: number;
  readonly openIncidents: number;
  readonly openGrievances: number;
  readonly criticalIncidents: number;
}

export interface DecisionItem {
  readonly id: string;
  readonly kind: string;
  readonly summary: string;
  readonly severity: string | null;
}

export interface DecisionsSlot {
  readonly pendingCount: number;
  readonly items: ReadonlyArray<DecisionItem>;
}

export interface CashRunwaySlot {
  /** Secondary sales-INFLOW signal (90-day net) — NOT a runway input. */
  readonly ninetyDayNetTzs: number;
  readonly dailyAvgTzs: number;
  readonly sampleCount: number;
  /**
   * REAL runway inputs — cash on hand ÷ net daily burn (mirrors the gateway
   * `CashRunwaySlotSchema`). Each is `null` when its feed is absent so the
   * card renders an honest unknown, never a fabricated number.
   */
  readonly cashOnHandTzs: number | null;
  readonly netDailyBurnTzs: number | null;
  /**
   * Days of cash at the current burn. `null` when unknown (inputs missing) OR
   * when the estate is net cash-positive (no finite runway). `burnStatus`
   * distinguishes the two.
   */
  readonly runwayDays: number | null;
  readonly burnStatus: 'burning' | 'no_burn' | 'unknown';
}

export interface ProductionSiteRow {
  readonly siteId: string | null;
  readonly tonnes: number;
  readonly fuel: number;
  readonly shifts: number;
}

export interface ProductionSlot {
  readonly window: '30d';
  readonly perSite: ReadonlyArray<ProductionSiteRow>;
}

export interface CliffStatusSlot {
  readonly cliffDateIso: string;
  readonly postCliffSales: number;
  readonly usdDenominated: number;
  readonly remediationComplete: boolean;
}

export interface IncidentItem {
  readonly id: string;
  readonly severity: string;
  readonly kind: string;
  readonly occurredAt: string | null;
}

export interface OpenHighIncidentsSlot {
  readonly count: number;
  readonly items: ReadonlyArray<IncidentItem>;
}

export interface LicenceItem {
  readonly id: string;
  readonly number: string | null;
  readonly kind: string | null;
  readonly daysToExpiry: number | null;
  readonly atRisk: boolean;
}

export interface LicenceHealthSlot {
  readonly totalCount: number;
  readonly atRiskCount: number;
  readonly items: ReadonlyArray<LicenceItem>;
}

export interface AdvisorSlot {
  readonly insight: string;
  readonly action: string;
  readonly generatedAtIso: string;
  readonly provider: string;
  readonly latencyMs: number;
  /**
   * ZERO-MIX: the locale the advisor prose (`insight` + `action`) was
   * PINNED to by the gateway. Render the prose under `lang={advisor.lang}`
   * so it is attributed honestly and matches the owner's active locale
   * (the gateway withholds a wrong-language cached note). `'en'` default
   * for wire compat with snapshots authored before locale-pinning.
   */
  readonly lang?: 'en' | 'sw';
  /**
   * R1 — inline citations. Each `¹²³` superscript glyph inside `insight`
   * maps to the evidence id at the same 1-based index in this array.
   * Optional for wire compatibility: older gateway versions emit no
   * evidence ids, and the renderer falls back to text-only.
   */
  readonly evidenceIds?: ReadonlyArray<string>;
}

export interface OwnerBriefPayload {
  readonly schemaVersion: 1;
  readonly composedAtIso: string;
  readonly dailyBrief: DailyBriefSlot;
  readonly decisions: DecisionsSlot;
  readonly cashRunway: CashRunwaySlot;
  readonly productionVsTarget: ProductionSlot;
  readonly cliffStatus: CliffStatusSlot;
  readonly openHighIncidents: OpenHighIncidentsSlot;
  readonly licenceHealth: LicenceHealthSlot;
  readonly advisor?: AdvisorSlot | null;
}

export interface OwnerBriefEnvelope {
  readonly brief: OwnerBriefPayload;
  readonly source: 'cron' | 'on-demand' | 'daily_cron';
  readonly generatedAt: string;
  readonly cached: boolean;
}

export interface OwnerDailyBriefEnvelope {
  readonly brief: OwnerBriefPayload | null;
  readonly source: 'cron' | 'on-demand' | 'daily_cron' | null;
  readonly generatedAt: string | null;
  readonly cached: boolean;
}

export const ownerBriefKeys = {
  all: ['owner-brief'] as const,
  current: () => [...ownerBriefKeys.all, 'current'] as const,
  daily: () => [...ownerBriefKeys.all, 'daily'] as const,
};

/**
 * Live wire to the unified BFF. The gateway returns 503
 * (`OWNER_BRIEF_UNAVAILABLE`) when the DB binding is missing — that
 * status reaches the caller via `ApiError` so the surface can render a
 * clear empty state.
 */
export function useOwnerBrief() {
  return useQuery<OwnerBriefEnvelope, ApiError>({
    queryKey: ownerBriefKeys.current(),
    queryFn: ({ signal }) =>
      // On-demand seven-slot composition can run an LLM pass server-side —
      // use the long timeout so it is not aborted by the 5s default.
      apiRequest<OwnerBriefEnvelope>('/api/v1/owner/brief', {
        signal,
        timeoutMs: LLM_REQUEST_TIMEOUT_MS,
      }),
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });
}

/**
 * Pulls today's daily-brief snapshot persisted by the daily-brief
 * cron. Falls through to the on-demand `/owner/brief` composition
 * when no cron snapshot exists.
 */
export function useOwnerDailyBrief() {
  return useQuery<OwnerDailyBriefEnvelope, ApiError>({
    queryKey: ownerBriefKeys.daily(),
    queryFn: ({ signal }) =>
      apiRequest<OwnerDailyBriefEnvelope>('/api/v1/owner/daily-brief', {
        signal,
        timeoutMs: LLM_REQUEST_TIMEOUT_MS,
      }),
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });
}
