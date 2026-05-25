/**
 * Kill switch — circuit breaker + emergency stop.
 *
 * Three scopes (in precedence order, most-specific wins for resolve):
 *
 *   1. global  — platform-wide; trips everything
 *   2. tenant  — all of one tenant's agents
 *   3. agent   — one agent (optionally scoped to one tenant)
 *
 * States:
 *   - active : normal operation
 *   - paused : temporary stop; auto-clears on `expiresAt`
 *   - killed : permanent stop; requires manual re-enable
 *
 * Auto-trip triggers (decide-time, supplied by caller):
 *   - error rate above threshold over a rolling window
 *   - cost spike above ceiling
 *   - anomaly score above threshold
 *   - regulator complaint flag set
 */

import type { KillSwitch, KillSwitchState } from '../types.js';

export interface KillSwitchStore {
  put(record: KillSwitch): Promise<void>;
  /** Most specific match: agent → tenant → global. */
  resolve(args: {
    agentId: string;
    tenantId: string;
  }): Promise<KillSwitch | null>;
  globalLatest(): Promise<KillSwitch | null>;
  list(): Promise<ReadonlyArray<KillSwitch>>;
}

export class InMemoryKillSwitchStore implements KillSwitchStore {
  readonly #records: KillSwitch[] = [];

  async put(record: KillSwitch): Promise<void> {
    // Latest record wins. Don't dedup — we want the full history for audit.
    this.#records.push(record);
  }

  async resolve(args: {
    agentId: string;
    tenantId: string;
  }): Promise<KillSwitch | null> {
    const now = new Date();
    // Most specific: agent (optionally tenant-scoped) → tenant → global
    const agentScoped = this.latestActive(
      (r) =>
        r.scope === 'agent' &&
        r.agentId === args.agentId &&
        (r.tenantId === undefined || r.tenantId === args.tenantId),
      now,
    );
    if (agentScoped) return agentScoped;

    const tenantScoped = this.latestActive(
      (r) => r.scope === 'tenant' && r.tenantId === args.tenantId,
      now,
    );
    if (tenantScoped) return tenantScoped;

    const globalScoped = this.latestActive(
      (r) => r.scope === 'global',
      now,
    );
    return globalScoped;
  }

  async globalLatest(): Promise<KillSwitch | null> {
    const now = new Date();
    return this.latestActive((r) => r.scope === 'global', now);
  }

  async list(): Promise<ReadonlyArray<KillSwitch>> {
    return [...this.#records];
  }

  private latestActive(
    predicate: (r: KillSwitch) => boolean,
    now: Date,
  ): KillSwitch | null {
    const matching = this.#records
      .filter(predicate)
      .slice()
      .reverse();
    for (const r of matching) {
      if (r.expiresAt !== undefined) {
        const expiry = new Date(r.expiresAt);
        if (now.getTime() >= expiry.getTime() && r.state === 'paused') {
          continue;
        }
      }
      return r;
    }
    return null;
  }
}

export interface PauseAgentArgs {
  readonly agentId: string;
  readonly tenantId?: string;
  readonly reason: string;
  readonly ttlSeconds: number;
  readonly triggeredBy: string;
  readonly autoTriggered?: boolean;
}

export async function pauseAgent(args: {
  readonly store: KillSwitchStore;
  readonly input: PauseAgentArgs;
  readonly now?: () => Date;
}): Promise<KillSwitch> {
  const now = (args.now ?? (() => new Date()))();
  const record: KillSwitch = {
    scope: 'agent',
    agentId: args.input.agentId,
    ...(args.input.tenantId !== undefined && { tenantId: args.input.tenantId }),
    state: 'paused',
    reason: args.input.reason,
    triggeredBy: args.input.triggeredBy,
    triggeredAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + args.input.ttlSeconds * 1000).toISOString(),
    autoTriggered: args.input.autoTriggered ?? false,
  };
  await args.store.put(record);
  return record;
}

export interface KillAgentArgs {
  readonly agentId: string;
  readonly tenantId?: string;
  readonly reason: string;
  readonly triggeredBy: string;
  readonly autoTriggered?: boolean;
}

export async function killAgent(args: {
  readonly store: KillSwitchStore;
  readonly input: KillAgentArgs;
  readonly now?: () => Date;
}): Promise<KillSwitch> {
  const now = (args.now ?? (() => new Date()))();
  const record: KillSwitch = {
    scope: 'agent',
    agentId: args.input.agentId,
    ...(args.input.tenantId !== undefined && { tenantId: args.input.tenantId }),
    state: 'killed',
    reason: args.input.reason,
    triggeredBy: args.input.triggeredBy,
    triggeredAt: now.toISOString(),
    autoTriggered: args.input.autoTriggered ?? false,
  };
  await args.store.put(record);
  return record;
}

export interface GlobalKillArgs {
  readonly reason: string;
  readonly triggeredBy: string;
  readonly autoTriggered?: boolean;
}

export async function globalKillSwitch(args: {
  readonly store: KillSwitchStore;
  readonly input: GlobalKillArgs;
  readonly now?: () => Date;
}): Promise<KillSwitch> {
  const now = (args.now ?? (() => new Date()))();
  const record: KillSwitch = {
    scope: 'global',
    state: 'killed',
    reason: args.input.reason,
    triggeredBy: args.input.triggeredBy,
    triggeredAt: now.toISOString(),
    autoTriggered: args.input.autoTriggered ?? false,
  };
  await args.store.put(record);
  return record;
}

export interface ResumeAgentArgs {
  readonly agentId: string;
  readonly tenantId?: string;
  readonly reason: string;
  readonly triggeredBy: string;
}

export async function resumeAgent(args: {
  readonly store: KillSwitchStore;
  readonly input: ResumeAgentArgs;
  readonly now?: () => Date;
}): Promise<KillSwitch> {
  const now = (args.now ?? (() => new Date()))();
  const record: KillSwitch = {
    scope: 'agent',
    agentId: args.input.agentId,
    ...(args.input.tenantId !== undefined && { tenantId: args.input.tenantId }),
    state: 'active',
    reason: args.input.reason,
    triggeredBy: args.input.triggeredBy,
    triggeredAt: now.toISOString(),
    autoTriggered: false,
  };
  await args.store.put(record);
  return record;
}

export interface GetKillSwitchStatusArgs {
  readonly store: KillSwitchStore;
  readonly agentId: string;
  readonly tenantId: string;
}

/**
 * Returns the effective state for a (agent, tenant) tuple, resolving
 * across all three scopes (agent → tenant → global).
 */
export async function getKillSwitchStatus(
  args: GetKillSwitchStatusArgs,
): Promise<KillSwitchState> {
  const record = await args.store.resolve({
    agentId: args.agentId,
    tenantId: args.tenantId,
  });
  if (!record) return 'active';
  return record.state;
}

// =========================================================================
// Auto-trip evaluation
// =========================================================================

export interface AutoTripInput {
  readonly errorRate: number; // 0..1
  readonly costSpikeRatio: number; // observed / baseline
  readonly anomalyScore: number; // 0..1
  readonly regulatorComplaintFlag: boolean;
}

export interface AutoTripThresholds {
  readonly errorRateMax: number; // e.g. 0.10
  readonly costSpikeMax: number; // e.g. 3.0  (3x baseline)
  readonly anomalyScoreMax: number; // e.g. 0.9
}

export const DEFAULT_AUTO_TRIP_THRESHOLDS: AutoTripThresholds = {
  errorRateMax: 0.1,
  costSpikeMax: 3,
  anomalyScoreMax: 0.9,
};

export interface AutoTripVerdict {
  readonly shouldTrip: boolean;
  readonly recommendedScope: 'agent' | 'tenant' | 'global' | null;
  readonly recommendedState: 'paused' | 'killed' | null;
  readonly reasons: ReadonlyArray<string>;
}

export function evaluateAutoTrip(
  input: AutoTripInput,
  thresholds: AutoTripThresholds = DEFAULT_AUTO_TRIP_THRESHOLDS,
): AutoTripVerdict {
  const reasons: string[] = [];
  let recommendedState: 'paused' | 'killed' | null = null;
  let recommendedScope: 'agent' | 'tenant' | 'global' | null = null;

  if (input.regulatorComplaintFlag) {
    reasons.push('Regulator complaint flag set');
    recommendedState = 'killed';
    recommendedScope = 'global';
  }
  if (input.errorRate > thresholds.errorRateMax) {
    reasons.push(
      `Error rate ${input.errorRate.toFixed(3)} exceeds ${thresholds.errorRateMax}`,
    );
    if (recommendedState !== 'killed') recommendedState = 'paused';
    if (recommendedScope === null) recommendedScope = 'agent';
  }
  if (input.costSpikeRatio > thresholds.costSpikeMax) {
    reasons.push(
      `Cost spike ${input.costSpikeRatio.toFixed(2)}x exceeds ${thresholds.costSpikeMax}x`,
    );
    if (recommendedState !== 'killed') recommendedState = 'paused';
    if (recommendedScope === null) recommendedScope = 'agent';
  }
  if (input.anomalyScore > thresholds.anomalyScoreMax) {
    reasons.push(
      `Anomaly score ${input.anomalyScore.toFixed(2)} exceeds ${thresholds.anomalyScoreMax}`,
    );
    if (recommendedState !== 'killed') recommendedState = 'paused';
    if (recommendedScope === null) recommendedScope = 'agent';
  }

  return {
    shouldTrip: reasons.length > 0,
    recommendedScope,
    recommendedState,
    reasons,
  };
}
