'use client';

/**
 * Risk-snapshot queries for the owner-os RiskPanel.
 *
 * Aggregates three live slices:
 *   1. FX / cliff exposure — GET /api/v1/mining/cockpit/27mar-cliff-status
 *   2. Open critical-control incidents — GET /api/v1/mining/incidents?severity=critical&status=open
 *   3. Kill-switch state — GET /api/v1/mining/internal/killswitch
 *      (returns the platform_killswitch_state rows; the owner-role JWT is
 *      allowed to read but not write; falls back to "unknown" gracefully
 *      on 403 so the panel never renders a static 'ARMED' lie).
 *
 * Each query has independent loading/error states so a failure in one
 * slice does not blank the whole panel.
 */

import { useQuery } from '@tanstack/react-query';
import { apiRequest, ApiError } from '@/lib/api-client';

// ── key factory ──────────────────────────────────────────────────────────────

export const riskKeys = {
  all: ['risk-snapshot'] as const,
  cliffStatus: () => [...riskKeys.all, 'cliff-status'] as const,
  criticalIncidents: () => [...riskKeys.all, 'critical-incidents'] as const,
  killswitch: () => [...riskKeys.all, 'killswitch'] as const,
};

// ── types ─────────────────────────────────────────────────────────────────────

export interface CliffStatusSlice {
  readonly usdDenominated: number;
  readonly remediationComplete: boolean;
  readonly note: string;
}

export interface KillswitchStateRow {
  readonly scope: string;
  readonly level: 'live' | 'degraded' | 'halt';
  readonly setAt: string;
  readonly reasonCode: string;
}

// ── hooks ─────────────────────────────────────────────────────────────────────

/**
 * FX cliff-exposure slice — the `usdDenominated` field is today's USD-
 * denominated exposure the owner acts on for hedging decisions.
 */
export function useRiskCliffStatus() {
  return useQuery({
    queryKey: riskKeys.cliffStatus(),
    queryFn: ({ signal }) =>
      apiRequest<CliffStatusSlice>(
        '/api/v1/mining/cockpit/27mar-cliff-status',
        { signal },
      ),
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
  });
}

/**
 * Count of open critical-severity incidents (control-failure proxy).
 * Returns `null` while loading or on error so the tile can render a
 * sensible fallback.
 */
export function useOpenCriticalIncidentCount() {
  const query = useQuery({
    queryKey: riskKeys.criticalIncidents(),
    queryFn: ({ signal }) =>
      apiRequest<ReadonlyArray<{ readonly id: string }>>(
        '/api/v1/mining/incidents?severity=critical&status=open',
        { signal },
      ),
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
  return {
    count: query.data?.length ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
  };
}

/**
 * Current kill-switch platform state.
 *
 * The owner-role JWT can read (GET /api/v1/mining/internal/killswitch
 * lists active states). On a 403 (e.g. if the endpoint requires
 * SUPER_ADMIN exclusively) we return status 'unknown' — NEVER fall back
 * to a hardcoded 'ARMED' string because that would be a false safety
 * reassurance.
 */
export function useKillswitchStatus() {
  return useQuery({
    queryKey: riskKeys.killswitch(),
    queryFn: async ({ signal }) => {
      const rows = await apiRequest<ReadonlyArray<KillswitchStateRow>>(
        '/api/v1/mining/internal/killswitch',
        { signal },
      );
      // The most recent platform-scoped row is the authoritative state.
      const platform = rows.find((r) => r.scope === 'platform');
      return platform ?? null;
    },
    staleTime: 30_000,
    refetchInterval: 30_000,
    // Gracefully degrade on auth errors — do NOT throw to the panel.
    retry: (failureCount, error) => {
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        return false;
      }
      return failureCount < 2;
    },
  });
}
