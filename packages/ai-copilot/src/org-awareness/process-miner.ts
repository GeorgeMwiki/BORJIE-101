/**
 * Process Miner — builds per-tenant statistical models of real processes.
 *
 * A "maintenance case in this org typically goes reported (avg 4h) →
 * triaged (avg 8h) → assigned (avg 12h) → in-progress (avg 32h) → resolved
 * (avg 72h) with a 12% re-open rate" — that is the kind of answer this
 * module produces.
 *
 * Inputs:  process_observations rows (append-only via event subscribers).
 * Outputs: ProcessStats — avg / p50 / p95 / p99 / variance per stage,
 *          variant distribution, re-open rate, stuck instances.
 *
 * Tenant isolation: every public method takes tenantId; the miner never
 * looks across tenants.
 */

import type {
  ProcessKind,
  ProcessObservation,
  ProcessObservationInput,
  ProcessObservationStore,
  ProcessStats,
  ProcessVariant,
  StageStats,
} from './types.js';

export interface ProcessMinerDeps {
  readonly store: ProcessObservationStore;
  readonly now?: () => Date;
}

export class ProcessMiner {
  private readonly deps: ProcessMinerDeps;

  constructor(deps: ProcessMinerDeps) {
    this.deps = deps;
  }

  /**
   * Record a process-stage observation. Caller typically wires this to
   * the platform event bus via `event-subscribers.ts`.
   */
  async observe(
    input: ProcessObservationInput,
  ): Promise<ProcessObservation> {
    return this.deps.store.append(input);
  }

  /**
   * Aggregate per-stage stats for a process kind within a tenant.
   * Returns zero-filled stats if no observations exist.
   */
  async getProcessStats(
    tenantId: string,
    processKind: ProcessKind,
  ): Promise<ProcessStats> {
    const rows = await this.deps.store.list(tenantId, processKind);
    const computedAt = (
      this.deps.now?.() ?? new Date()
    ).toISOString();

    if (rows.length === 0) {
      return {
        tenantId,
        processKind,
        totalObservations: 0,
        distinctInstances: 0,
        reopenRate: 0,
        stuckInstances: 0,
        variantDistribution: emptyVariantDistribution(),
        stages: [],
        computedAt,
      };
    }

    const durationsByStage = new Map<string, number[]>();
    const instanceSet = new Set<string>();
    const stuckInstances = new Set<string>();
    let reopens = 0;
    const variantDist: Record<ProcessVariant, number> =
      emptyVariantDistribution();

    for (const r of rows) {
      instanceSet.add(r.processInstanceId);
      if (r.isReopen) reopens++;
      if (r.isStuck) stuckInstances.add(r.processInstanceId);
      variantDist[r.variant] = (variantDist[r.variant] ?? 0) + 1;
      if (typeof r.durationMsFromPrevious === 'number') {
        const list = durationsByStage.get(r.stage) ?? [];
        list.push(r.durationMsFromPrevious);
        durationsByStage.set(r.stage, list);
      }
    }

    const stages: StageStats[] = Array.from(durationsByStage.entries())
      .map(([stage, durations]) => buildStageStats(stage, durations))
      .sort((a, b) => b.avgMs - a.avgMs);

    return {
      tenantId,
      processKind,
      totalObservations: rows.length,
      distinctInstances: instanceSet.size,
      reopenRate:
        instanceSet.size === 0 ? 0 : reopens / instanceSet.size,
      stuckInstances: stuckInstances.size,
      variantDistribution: variantDist,
      stages,
      computedAt,
    };
  }

  /**
   * Detect variant for a single process instance based on its
   * observation history. Returns the label suggested for the next
   * observation appended for this instance.
   */
  async detectVariant(
    tenantId: string,
    processKind: ProcessKind,
    processInstanceId: string,
  ): Promise<ProcessVariant> {
    const rows = await this.deps.store.listByInstance(
      tenantId,
      processKind,
      processInstanceId,
    );
    if (rows.length === 0) return 'standard';
    if (rows.some((r) => r.metadata && r.metadata.priority === 'emergency')) {
      return 'emergency';
    }
    if (rows.some((r) => r.isStuck)) return 'stuck_path';
    if (rows.some((r) => r.metadata && r.metadata.fast === true)) {
      return 'fast_path';
    }
    return 'standard';
  }
}

export function createProcessMiner(deps: ProcessMinerDeps): ProcessMiner {
  return new ProcessMiner(deps);
}

export function percentile(
  sortedNumbers: readonly number[],
  p: number,
): number {
  if (sortedNumbers.length === 0) return 0;
  if (sortedNumbers.length === 1) return sortedNumbers[0];
  const rank = (p / 100) * (sortedNumbers.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sortedNumbers[lo];
  const weight = rank - lo;
  return Math.round(
    sortedNumbers[lo] * (1 - weight) + sortedNumbers[hi] * weight,
  );
}

export function buildStageStats(
  stage: string,
  durations: readonly number[],
): StageStats {
  if (durations.length === 0) {
    return {
      stage,
      sampleSize: 0,
      avgMs: 0,
      p50Ms: 0,
      p95Ms: 0,
      p99Ms: 0,
      varianceMs: 0,
    };
  }
  const sorted = [...durations].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  const avg = sum / sorted.length;
  const variance =
    sorted.reduce((acc, v) => acc + (v - avg) ** 2, 0) / sorted.length;
  return {
    stage,
    sampleSize: sorted.length,
    avgMs: Math.round(avg),
    p50Ms: percentile(sorted, 50),
    p95Ms: percentile(sorted, 95),
    p99Ms: percentile(sorted, 99),
    varianceMs: Math.round(variance),
  };
}

function emptyVariantDistribution(): Record<ProcessVariant, number> {
  return {
    standard: 0,
    emergency: 0,
    stuck_path: 0,
    fast_path: 0,
  };
}
