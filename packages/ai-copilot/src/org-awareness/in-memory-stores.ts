/**
 * In-memory stores for org-awareness — the default binding used by tests
 * and pilots. Replace with Postgres-backed implementations in the
 * api-gateway composition root.
 *
 * Immutable-append semantics: every method returns new objects. Mutable
 * arrays are implementation detail but state mutations are confined to
 * the private class state — no caller-visible object is ever mutated.
 */

import { v4 as uuid } from 'uuid';
import type {
  Bottleneck,
  BottleneckStore,
  ImprovementMetric,
  ImprovementSnapshot,
  ImprovementSnapshotInput,
  ImprovementSnapshotStore,
  NewBottleneckInput,
  ProcessKind,
  ProcessObservation,
  ProcessObservationInput,
  ProcessObservationStore,
} from './types.js';

export class InMemoryProcessObservationStore
  implements ProcessObservationStore
{
  private readonly rows: ProcessObservation[] = [];

  async append(
    input: ProcessObservationInput,
  ): Promise<ProcessObservation> {
    const row: ProcessObservation = {
      id: `obs_${uuid()}`,
      tenantId: input.tenantId,
      processKind: input.processKind,
      processInstanceId: input.processInstanceId,
      stage: input.stage,
      previousStage: input.previousStage,
      actorKind: input.actorKind,
      actorId: input.actorId,
      variant: input.variant ?? 'standard',
      isReopen: Boolean(input.isReopen),
      isStuck: Boolean(input.isStuck),
      durationMsFromPrevious: input.durationMsFromPrevious,
      metadata: input.metadata ?? {},
      observedAt: input.observedAt ?? new Date(),
    };
    this.rows.push(row);
    return row;
  }

  async list(
    tenantId: string,
    processKind?: ProcessKind,
    limit = 10_000,
  ): Promise<readonly ProcessObservation[]> {
    const filtered = this.rows.filter(
      (r) =>
        r.tenantId === tenantId &&
        (processKind === undefined || r.processKind === processKind),
    );
    return filtered.slice(-limit).map((r) => ({ ...r }));
  }

  async listByInstance(
    tenantId: string,
    processKind: ProcessKind,
    processInstanceId: string,
  ): Promise<readonly ProcessObservation[]> {
    return this.rows
      .filter(
        (r) =>
          r.tenantId === tenantId &&
          r.processKind === processKind &&
          r.processInstanceId === processInstanceId,
      )
      .map((r) => ({ ...r }));
  }
}

export class InMemoryBottleneckStore implements BottleneckStore {
  private readonly rows: Bottleneck[] = [];

  async upsertOpen(input: NewBottleneckInput): Promise<Bottleneck> {
    const now = new Date().toISOString();
    const existingIdx = this.rows.findIndex(
      (r) =>
        r.tenantId === input.tenantId &&
        r.processKind === input.processKind &&
        r.stage === input.stage &&
        r.bottleneckKind === input.bottleneckKind &&
        r.status === 'open',
    );
    if (existingIdx >= 0) {
      const existing = this.rows[existingIdx];
      if (existing.cooldownUntil && existing.cooldownUntil > now) {
        return existing;
      }
      const updated: Bottleneck = {
        ...existing,
        severity: input.severity,
        evidence: input.evidence,
        suggestedRemediation: input.suggestedRemediation,
        lastSeenAt: now,
      };
      this.rows[existingIdx] = updated;
      return updated;
    }
    const row: Bottleneck = {
      id: `btn_${uuid()}`,
      tenantId: input.tenantId,
      processKind: input.processKind,
      stage: input.stage,
      bottleneckKind: input.bottleneckKind,
      severity: input.severity,
      status: 'open',
      evidence: input.evidence,
      suggestedRemediation: input.suggestedRemediation,
      firstDetectedAt: now,
      lastSeenAt: now,
    };
    this.rows.push(row);
    return row;
  }

  async listOpen(tenantId: string): Promise<readonly Bottleneck[]> {
    const severityRank: Record<string, number> = { P1: 0, P2: 1, P3: 2 };
    return this.rows
      .filter((r) => r.tenantId === tenantId && r.status === 'open')
      .sort(
        (a, b) => severityRank[a.severity] - severityRank[b.severity],
      )
      .map((r) => ({ ...r }));
  }

  async resolve(tenantId: string, bottleneckId: string): Promise<void> {
    const idx = this.rows.findIndex(
      (r) => r.tenantId === tenantId && r.id === bottleneckId,
    );
    if (idx < 0) return;
    this.rows[idx] = {
      ...this.rows[idx],
      status: 'resolved',
      resolvedAt: new Date().toISOString(),
    };
  }

  async snooze(
    tenantId: string,
    bottleneckId: string,
    until: Date,
  ): Promise<void> {
    const idx = this.rows.findIndex(
      (r) => r.tenantId === tenantId && r.id === bottleneckId,
    );
    if (idx < 0) return;
    this.rows[idx] = {
      ...this.rows[idx],
      cooldownUntil: until.toISOString(),
    };
  }
}

export class InMemoryImprovementSnapshotStore
  implements ImprovementSnapshotStore
{
  private readonly rows: ImprovementSnapshot[] = [];

  async upsert(
    input: ImprovementSnapshotInput,
  ): Promise<ImprovementSnapshot> {
    const existingIdx = this.rows.findIndex(
      (r) =>
        r.tenantId === input.tenantId &&
        r.metric === input.metric &&
        r.periodKind === input.periodKind &&
        r.periodStart.getTime() === input.periodStart.getTime(),
    );
    const row: ImprovementSnapshot = {
      id:
        existingIdx >= 0 ? this.rows[existingIdx].id : `snap_${uuid()}`,
      tenantId: input.tenantId,
      metric: input.metric,
      periodKind: input.periodKind,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      value: input.value,
      sampleSize: input.sampleSize ?? 0,
      confidenceLow: input.confidenceLow,
      confidenceHigh: input.confidenceHigh,
      isBaseline: Boolean(input.isBaseline),
      evidence: input.evidence ?? {},
      createdAt:
        existingIdx >= 0
          ? this.rows[existingIdx].createdAt
          : new Date().toISOString(),
    };
    if (existingIdx >= 0) {
      this.rows[existingIdx] = row;
    } else {
      this.rows.push(row);
    }
    return row;
  }

  async listForMetric(
    tenantId: string,
    metric: ImprovementMetric,
  ): Promise<readonly ImprovementSnapshot[]> {
    return this.rows
      .filter((r) => r.tenantId === tenantId && r.metric === metric)
      .sort(
        (a, b) => a.periodStart.getTime() - b.periodStart.getTime(),
      )
      .map((r) => ({ ...r }));
  }

  async getBaseline(
    tenantId: string,
    metric: ImprovementMetric,
  ): Promise<ImprovementSnapshot | null> {
    const list = await this.listForMetric(tenantId, metric);
    const baseline = list.find((r) => r.isBaseline);
    if (baseline) return baseline;
    return list.length > 0 ? list[0] : null;
  }

  async getLatest(
    tenantId: string,
    metric: ImprovementMetric,
  ): Promise<ImprovementSnapshot | null> {
    const list = await this.listForMetric(tenantId, metric);
    return list.length > 0 ? list[list.length - 1] : null;
  }
}
