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

/**
 * Closed set of kill-switch levels this panel knows how to render. The wire
 * advertises `'live' | 'degraded' | 'halt'`, but that is a COMPILE-TIME
 * promise the gateway can break at runtime (a new level, a typo, a partial
 * deploy). `'unknown'` is the explicit fail-SAFE sink for any value outside
 * the known set — deliberately NOT `'live'`, because silently mapping an
 * unrecognized level to "live" would be a false safety reassurance on a
 * risk/safety read. Mirrors admin-web `clampKillswitchLevel`.
 */
export const KILLSWITCH_LEVELS = [
  'live',
  'degraded',
  'halt',
  'unknown',
] as const;

export type KillswitchLevel = (typeof KILLSWITCH_LEVELS)[number];

/**
 * Clamp an arbitrary runtime value to the known kill-switch enum at this
 * adapter boundary. Any value outside the closed set — including
 * `null`/`undefined`, an unexpected gateway string, or a non-string —
 * collapses to the conservative `'unknown'` sentinel rather than passing
 * through unvalidated (which would later `undefined`-deref a label lookup).
 * Fail-safe, never fail-open: an unrecognized level NEVER becomes `'live'`.
 */
export function clampKillswitchLevel(value: unknown): KillswitchLevel {
  return (KILLSWITCH_LEVELS as ReadonlyArray<string>).includes(value as string)
    ? (value as KillswitchLevel)
    : 'unknown';
}

export interface KillswitchStateRow {
  readonly scope: string;
  readonly level: KillswitchLevel;
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
    queryFn: async ({ signal }): Promise<KillswitchStateRow | null> => {
      // The wire is typed as `KillswitchStateRow`, but the gateway can break
      // that compile-time promise at runtime — so we read the raw shape and
      // clamp `level` to the closed enum at this adapter boundary.
      const rows = await apiRequest<ReadonlyArray<Record<string, unknown>>>(
        '/api/v1/mining/internal/killswitch',
        { signal },
      );
      // The most recent platform-scoped row is the authoritative state.
      const platform = rows.find((r) => r.scope === 'platform');
      if (!platform) return null;
      return {
        scope: typeof platform.scope === 'string' ? platform.scope : 'platform',
        level: clampKillswitchLevel(platform.level),
        setAt: typeof platform.setAt === 'string' ? platform.setAt : '',
        reasonCode:
          typeof platform.reasonCode === 'string' ? platform.reasonCode : '',
      };
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
