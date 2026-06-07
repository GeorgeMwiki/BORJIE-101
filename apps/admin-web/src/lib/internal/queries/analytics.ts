/**
 * react-query bindings for /api/v1/mining/internal/analytics.
 *
 * Live endpoints (services/api-gateway/src/routes/mining/internal/analytics.hono.ts):
 *   GET /funnel?days=  — activation funnel: distinct tenants per ordered
 *                        milestone within a lookback window.
 *   GET /cohorts       — monthly signup cohorts + activation retention proxy.
 *
 * Both aggregate the REAL append-only `activation_events` log (migration
 * 0300). Live-only: failures propagate to react-query's `error` channel.
 */

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';

const FUNNEL_KEY = ['internal', 'analytics', 'funnel'] as const;
const COHORTS_KEY = ['internal', 'analytics', 'cohorts'] as const;

export interface FunnelStep {
  readonly eventType: string;
  readonly label: string;
  readonly count: number;
}

interface FunnelPayload {
  readonly windowDays: number;
  readonly steps: ReadonlyArray<FunnelStep>;
}

interface RawFunnel {
  readonly windowDays?: number;
  readonly steps?: ReadonlyArray<{
    readonly eventType?: string;
    readonly label?: string;
    readonly count?: number;
  }>;
}

function adaptFunnel(raw: RawFunnel | null): FunnelPayload {
  const steps = (raw?.steps ?? []).map((s) => ({
    eventType: s.eventType ?? 'unknown',
    label: s.label ?? s.eventType ?? 'unknown',
    count: Number(s.count ?? 0),
  }));
  return { windowDays: Number(raw?.windowDays ?? 90), steps };
}

export function useActivationFunnelQuery(days = 90) {
  return useQuery({
    queryKey: [...FUNNEL_KEY, days] as const,
    queryFn: async (): Promise<FunnelPayload> => {
      const res = await apiClient.get<RawFunnel>(
        `/analytics/funnel?days=${encodeURIComponent(String(days))}`,
      );
      if (!res.ok) throw new Error(res.message);
      return adaptFunnel(res.data);
    },
  });
}

export interface Cohort {
  readonly cohort: string;
  readonly signedUp: number;
  readonly activated: number;
  readonly activationPct: number;
}

interface CohortsPayload {
  readonly cohorts: ReadonlyArray<Cohort>;
}

interface RawCohorts {
  readonly cohorts?: ReadonlyArray<{
    readonly cohort?: string;
    readonly signedUp?: number;
    readonly activated?: number;
    readonly activationPct?: number;
  }>;
}

function adaptCohorts(raw: RawCohorts | null): CohortsPayload {
  const cohorts = (raw?.cohorts ?? []).map((r) => ({
    cohort: r.cohort ?? '',
    signedUp: Number(r.signedUp ?? 0),
    activated: Number(r.activated ?? 0),
    activationPct: Number(r.activationPct ?? 0),
  }));
  return { cohorts };
}

export function useCohortsQuery() {
  return useQuery({
    queryKey: COHORTS_KEY,
    queryFn: async (): Promise<CohortsPayload> => {
      const res = await apiClient.get<RawCohorts>('/analytics/cohorts');
      if (!res.ok) throw new Error(res.message);
      return adaptCohorts(res.data);
    },
  });
}
