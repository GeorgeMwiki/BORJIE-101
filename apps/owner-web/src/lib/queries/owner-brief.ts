'use client';

import { useQuery } from '@tanstack/react-query';
import { apiRequest, ApiError } from '@/lib/api-client';

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
  readonly ninetyDayNetTzs: number;
  readonly dailyAvgTzs: number;
  readonly sampleCount: number;
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
}

export interface OwnerBriefEnvelope {
  readonly brief: OwnerBriefPayload;
  readonly source: 'cron' | 'on-demand';
  readonly generatedAt: string;
  readonly cached: boolean;
}

export const ownerBriefKeys = {
  all: ['owner-brief'] as const,
  current: () => [...ownerBriefKeys.all, 'current'] as const,
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
      apiRequest<OwnerBriefEnvelope>('/api/v1/owner/brief', { signal }),
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });
}
