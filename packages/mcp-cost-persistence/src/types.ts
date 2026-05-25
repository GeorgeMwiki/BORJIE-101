/**
 * MCP cost-persistence + health-scheduler — public types.
 *
 * Tracks per-tool MCP call cost (USD micros) and per-tool latency /
 * error histograms. Health scheduler proactively probes each MCP
 * server at a configurable cadence and surfaces degradation BEFORE
 * production traffic hits it.
 *
 * Pure kernel — production wiring plugs Supabase and the real fetch
 * call; tests inject in-memory sink + probe port.
 */

export type ModelTier = "free" | "cheap" | "standard" | "premium";

export interface McpCostEntry {
  readonly toolName: string;
  readonly serverId: string;
  readonly tier: ModelTier;
  readonly estimatedCostUsd: number;
  readonly actualCostUsd?: number;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly wasFree: boolean;
  readonly tenantId?: string;
  readonly sessionId?: string;
  readonly callDurationMs?: number;
  readonly ts: number;
}

export interface McpCostSnapshot {
  readonly totalCostUsd: number;
  readonly costByTier: Readonly<Record<ModelTier, number>>;
  readonly costByServer: Readonly<Record<string, number>>;
  readonly freeCallCount: number;
  readonly paidCallCount: number;
  readonly periodStartIso: string;
  readonly periodEndIso: string;
}

/** Pluggable persistence sink for cost entries. */
export interface CostSink {
  insert(entries: ReadonlyArray<McpCostEntry>): Promise<void>;
}

/** Probe outcome for a single MCP server. */
export interface HealthProbeResult {
  readonly serverId: string;
  readonly healthy: boolean;
  readonly latencyMs?: number;
  readonly errorMessage?: string;
  readonly observedAtIso: string;
}

/** Pluggable probe — implementations may hit HTTP / stdio / etc. */
export interface HealthProbe {
  check(serverId: string): Promise<HealthProbeResult>;
}
