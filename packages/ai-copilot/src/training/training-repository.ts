/**
 * TrainingRepository — storage port + in-memory implementation.
 *
 * Kept as a port so the api-gateway composition root can swap a Postgres
 * adapter in without touching the domain services. The in-memory version is
 * used by tests and by any degraded-mode environment.
 *
 * All reads and writes are tenant-scoped — every method that can cross
 * tenants accepts the tenantId as a first-class parameter.
 */

import type {
  PathEditInput,
  TrainingAssignment,
  TrainingAssignmentStatus,
  TrainingDeliveryEvent,
  TrainingDeliveryEventType,
  TrainingPath,
  TrainingPathStep,
} from './training-types.js';
import { TenantMismatchError, TrainingNotFoundError } from './training-types.js';

export interface TrainingRepository {
  upsertPath(path: TrainingPath): Promise<TrainingPath>;
  getPath(tenantId: string, pathId: string): Promise<TrainingPath | null>;
  listPaths(tenantId: string): Promise<readonly TrainingPath[]>;
  findPathByTopic(
    tenantId: string,
    topic: string,
    audience: string
  ): Promise<TrainingPath | null>;
  updatePath(
    tenantId: string,
    pathId: string,
    edits: PathEditInput,
    idFactory: (prefix: string) => string
  ): Promise<TrainingPath>;

  createAssignment(a: TrainingAssignment): Promise<TrainingAssignment>;
  getAssignment(tenantId: string, id: string): Promise<TrainingAssignment | null>;
  listAssignments(
    tenantId: string,
    filter?: { status?: TrainingAssignmentStatus; assigneeUserId?: string }
  ): Promise<readonly TrainingAssignment[]>;
  updateAssignment(
    tenantId: string,
    id: string,
    patch: Partial<
      Pick<
        TrainingAssignment,
        'status' | 'completedAt' | 'progressPct' | 'lastDeliveredStep'
      >
    >
  ): Promise<TrainingAssignment>;

  appendEvent(evt: TrainingDeliveryEvent): Promise<TrainingDeliveryEvent>;
  listEvents(
    tenantId: string,
    assignmentId: string
  ): Promise<readonly TrainingDeliveryEvent[]>;
}

export class InMemoryTrainingRepository implements TrainingRepository {
  private readonly paths = new Map<string, TrainingPath>();
  private readonly assignments = new Map<string, TrainingAssignment>();
  private readonly events: TrainingDeliveryEvent[] = [];

  async upsertPath(path: TrainingPath): Promise<TrainingPath> {
    // Idempotency by (tenantId, topic, audience): if a path with those keys
    // exists, keep its id and treat this upsert as an update.
    const existing = Array.from(this.paths.values()).find(
      (p) =>
        p.tenantId === path.tenantId &&
        p.topic === path.topic &&
        p.audience === path.audience &&
        !p.deletedAt
    );
    if (existing) {
      const merged: TrainingPath = {
        ...path,
        id: existing.id,
        createdAt: existing.createdAt,
        updatedAt: new Date().toISOString(),
      };
      this.paths.set(existing.id, merged);
      return merged;
    }
    this.paths.set(path.id, path);
    return path;
  }

  async getPath(tenantId: string, pathId: string): Promise<TrainingPath | null> {
    const p = this.paths.get(pathId);
    if (!p) return null;
    if (p.tenantId !== tenantId) throw new TenantMismatchError();
    if (p.deletedAt) return null;
    return p;
  }

  async listPaths(tenantId: string): Promise<readonly TrainingPath[]> {
    return Array.from(this.paths.values()).filter(
      (p) => p.tenantId === tenantId && !p.deletedAt
    );
  }

  async findPathByTopic(
    tenantId: string,
    topic: string,
    audience: string
  ): Promise<TrainingPath | null> {
    return (
      Array.from(this.paths.values()).find(
        (p) =>
          p.tenantId === tenantId &&
          p.topic === topic &&
          p.audience === audience &&
          !p.deletedAt
      ) ?? null
    );
  }

  async updatePath(
    tenantId: string,
    pathId: string,
    edits: PathEditInput,
    idFactory: (prefix: string) => string
  ): Promise<TrainingPath> {
    const existing = this.paths.get(pathId);
    if (!existing) throw new TrainingNotFoundError(`path ${pathId} not found`);
    if (existing.tenantId !== tenantId) throw new TenantMismatchError();

    const newSteps: readonly TrainingPathStep[] = edits.steps
      ? edits.steps.map((s, i) => ({
          id: idFactory('tstep'),
          pathId,
          orderIndex: i,
          conceptId: s.conceptId,
          kind: s.kind,
          title: s.title,
          content: s.content,
          masteryThreshold: s.masteryThreshold ?? 0.8,
          estimatedMinutes: s.estimatedMinutes ?? 5,
        }))
      : existing.steps;

    const updated: TrainingPath = {
      ...existing,
      title: edits.title ?? existing.title,
      summary: edits.summary ?? existing.summary,
      durationMinutes: edits.durationMinutes ?? existing.durationMinutes,
      steps: newSteps,
      conceptIds: newSteps.map((s) => s.conceptId),
      updatedAt: new Date().toISOString(),
    };
    this.paths.set(pathId, updated);
    return updated;
  }

  async createAssignment(a: TrainingAssignment): Promise<TrainingAssignment> {
    this.assignments.set(a.id, a);
    return a;
  }

  async getAssignment(
    tenantId: string,
    id: string
  ): Promise<TrainingAssignment | null> {
    const a = this.assignments.get(id);
    if (!a) return null;
    if (a.tenantId !== tenantId) throw new TenantMismatchError();
    return a;
  }

  async listAssignments(
    tenantId: string,
    filter?: { status?: TrainingAssignmentStatus; assigneeUserId?: string }
  ): Promise<readonly TrainingAssignment[]> {
    return Array.from(this.assignments.values()).filter((a) => {
      if (a.tenantId !== tenantId) return false;
      if (filter?.status && a.status !== filter.status) return false;
      if (filter?.assigneeUserId && a.assigneeUserId !== filter.assigneeUserId)
        return false;
      return true;
    });
  }

  async updateAssignment(
    tenantId: string,
    id: string,
    patch: Partial<
      Pick<
        TrainingAssignment,
        'status' | 'completedAt' | 'progressPct' | 'lastDeliveredStep'
      >
    >
  ): Promise<TrainingAssignment> {
    const existing = this.assignments.get(id);
    if (!existing) throw new TrainingNotFoundError('assignment not found');
    if (existing.tenantId !== tenantId) throw new TenantMismatchError();
    const updated: TrainingAssignment = { ...existing, ...patch };
    this.assignments.set(id, updated);
    return updated;
  }

  async appendEvent(evt: TrainingDeliveryEvent): Promise<TrainingDeliveryEvent> {
    this.events.push(evt);
    return evt;
  }

  async listEvents(
    tenantId: string,
    assignmentId: string
  ): Promise<readonly TrainingDeliveryEvent[]> {
    return this.events.filter(
      (e) => e.tenantId === tenantId && e.assignmentId === assignmentId
    );
  }
}

// Helper factory used by routes / DI
export function createInMemoryTrainingRepository(): TrainingRepository {
  return new InMemoryTrainingRepository();
}

// Generic event type shortener (kept here so callers don't need types import)
export const TRAINING_EVENT_TYPES: readonly TrainingDeliveryEventType[] = [
  'step_started',
  'answer_submitted',
  'concept_mastered',
  'stuck',
  'continued',
  'path_completed',
];
