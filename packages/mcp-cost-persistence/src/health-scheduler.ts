/**
 * MCP health-scheduler — proactive degradation detection.
 *
 * Pure scheduler — does NOT call setInterval. The caller drives it
 * by invoking `runProbeCycle` at the desired cadence (or via
 * `services/scheduled-tasks` if integrated). This keeps the kernel
 * test-friendly: production wires a 5-minute timer; tests call
 * directly.
 */

import type { HealthProbe, HealthProbeResult } from "./types.js";

export interface ProbeCycleResult {
  readonly results: ReadonlyArray<HealthProbeResult>;
  readonly unhealthyCount: number;
  readonly cycleStartedAtIso: string;
  readonly cycleEndedAtIso: string;
}

export interface ProbeCycleOptions {
  readonly nowIso?: () => string;
}

/**
 * Probe every server in `serverIds` via the injected probe. Returns
 * structured results; never throws. Errors per server are captured
 * in the corresponding `HealthProbeResult.errorMessage`.
 */
export async function runProbeCycle(
  probe: HealthProbe,
  serverIds: ReadonlyArray<string>,
  options: ProbeCycleOptions = {},
): Promise<ProbeCycleResult> {
  const now = options.nowIso ?? (() => new Date().toISOString());
  const cycleStartedAtIso = now();
  const results: HealthProbeResult[] = [];
  for (const serverId of serverIds) {
    try {
      const r = await probe.check(serverId);
      results.push(r);
    } catch (e) {
      results.push({
        serverId,
        healthy: false,
        errorMessage: (e as Error).message,
        observedAtIso: now(),
      });
    }
  }
  const unhealthyCount = results.filter((r) => !r.healthy).length;
  return {
    results,
    unhealthyCount,
    cycleStartedAtIso,
    cycleEndedAtIso: now(),
  };
}

export interface HealthHistoryState {
  readonly history: ReadonlyArray<HealthProbeResult>;
  readonly maxEntries: number;
}

export function createHealthHistory(maxEntries = 1000): HealthHistoryState {
  return { history: [], maxEntries };
}

export function recordCycle(
  state: HealthHistoryState,
  cycle: ProbeCycleResult,
): HealthHistoryState {
  const merged = [...state.history, ...cycle.results];
  while (merged.length > state.maxEntries) merged.shift();
  return { ...state, history: merged };
}

/**
 * Latest observation per server. Useful for an admin dashboard.
 */
export function latestPerServer(
  state: HealthHistoryState,
): ReadonlyArray<HealthProbeResult> {
  const latest = new Map<string, HealthProbeResult>();
  for (const r of state.history) {
    const existing = latest.get(r.serverId);
    if (!existing || r.observedAtIso > existing.observedAtIso) {
      latest.set(r.serverId, r);
    }
  }
  return [...latest.values()];
}
