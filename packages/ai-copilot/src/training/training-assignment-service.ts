/**
 * TrainingAssignmentService — attaches a generated path to one or more
 * employees, persists the assignment row, and publishes a `TrainingAssigned`
 * event onto the shared event bus.
 *
 * Respects tenant isolation: an admin in tenant A cannot create assignments
 * against users whose home tenant is B (the route layer surfaces user →
 * tenant, but the service re-asserts on the assignment itself).
 *
 * Feature-flag gated by `training.enabled` (default true). When flagged off
 * the service refuses to create assignments and throws TrainingDisabledError.
 */

import type { TrainingRepository } from './training-repository.js';
import type {
  AssignTrainingInput,
  TrainingAssignment,
} from './training-types.js';
import {
  TenantMismatchError,
  TrainingDisabledError,
  TrainingNotFoundError,
} from './training-types.js';

export interface TrainingEventPublisher {
  publish(event: {
    readonly type: string;
    readonly tenantId: string;
    readonly payload: Readonly<Record<string, unknown>>;
  }): Promise<void> | void;
}

export interface FeatureFlagLike {
  isEnabled(tenantId: string, flag: string): Promise<boolean> | boolean;
}

export interface TrainingAssignmentDeps {
  readonly repo: TrainingRepository;
  readonly eventBus?: TrainingEventPublisher | null;
  readonly featureFlags?: FeatureFlagLike | null;
  readonly now?: () => Date;
  readonly idFactory?: (prefix: string) => string;
}

const DEFAULT_FLAG = 'training.enabled';

function defaultId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now()}_${rand}`;
}

export class TrainingAssignmentService {
  private readonly repo: TrainingRepository;
  private readonly eventBus: TrainingEventPublisher | null;
  private readonly flags: FeatureFlagLike | null;
  private readonly now: () => Date;
  private readonly idFactory: (prefix: string) => string;

  constructor(deps: TrainingAssignmentDeps) {
    this.repo = deps.repo;
    this.eventBus = deps.eventBus ?? null;
    this.flags = deps.featureFlags ?? null;
    this.now = deps.now ?? (() => new Date());
    this.idFactory = deps.idFactory ?? defaultId;
  }

  async assignTraining(
    input: AssignTrainingInput
  ): Promise<readonly TrainingAssignment[]> {
    this.validate(input);

    if (this.flags) {
      const enabled = await this.flags.isEnabled(input.tenantId, DEFAULT_FLAG);
      if (!enabled) {
        throw new TrainingDisabledError();
      }
    }

    const path = await this.repo.getPath(input.tenantId, input.pathId);
    if (!path) {
      throw new TrainingNotFoundError(`path ${input.pathId} not found`);
    }
    if (path.tenantId !== input.tenantId) {
      throw new TenantMismatchError();
    }

    const nowIso = this.now().toISOString();
    const assignments: TrainingAssignment[] = [];
    const uniqueAssignees = Array.from(new Set(input.assigneeUserIds));

    for (const userId of uniqueAssignees) {
      const existing = (
        await this.repo.listAssignments(input.tenantId, {
          assigneeUserId: userId,
        })
      ).find((a) => a.pathId === input.pathId);
      if (existing && existing.status !== 'abandoned' && existing.status !== 'reassigned') {
        assignments.push(existing);
        continue;
      }
      const assignment: TrainingAssignment = {
        id: this.idFactory('tassign'),
        tenantId: input.tenantId,
        pathId: input.pathId,
        assigneeUserId: userId,
        assignedBy: input.assignedBy,
        assignedAt: nowIso,
        dueAt: input.dueAt ? input.dueAt.toISOString() : null,
        status: 'pending',
        completedAt: null,
        progressPct: 0,
        lastDeliveredStep: null,
      };
      const saved = await this.repo.createAssignment(assignment);
      assignments.push(saved);

      if (this.eventBus) {
        await this.eventBus.publish({
          type: 'training.assigned',
          tenantId: input.tenantId,
          payload: {
            assignmentId: saved.id,
            pathId: saved.pathId,
            assigneeUserId: saved.assigneeUserId,
            assignedBy: saved.assignedBy,
            dueAt: saved.dueAt,
          },
        });
      }
    }

    return assignments;
  }

  async forceComplete(
    tenantId: string,
    assignmentId: string,
    actorUserId: string
  ): Promise<TrainingAssignment> {
    const existing = await this.repo.getAssignment(tenantId, assignmentId);
    if (!existing) {
      throw new TrainingNotFoundError(`assignment ${assignmentId} not found`);
    }
    const nowIso = this.now().toISOString();
    const updated = await this.repo.updateAssignment(tenantId, assignmentId, {
      status: 'completed',
      completedAt: nowIso,
      progressPct: 1,
    });
    if (this.eventBus) {
      await this.eventBus.publish({
        type: 'training.force_completed',
        tenantId,
        payload: {
          assignmentId,
          actorUserId,
          completedAt: nowIso,
        },
      });
    }
    return updated;
  }

  private validate(input: AssignTrainingInput): void {
    if (!input.tenantId) throw new Error('tenantId required');
    if (!input.pathId) throw new Error('pathId required');
    if (!input.assignedBy) throw new Error('assignedBy required');
    if (!Array.isArray(input.assigneeUserIds) || input.assigneeUserIds.length === 0) {
      throw new Error('at least one assignee required');
    }
    if (input.assigneeUserIds.length > 200) {
      throw new Error('too many assignees in one call');
    }
    for (const uid of input.assigneeUserIds) {
      if (typeof uid !== 'string' || uid.trim().length === 0) {
        throw new Error('invalid assignee user id');
      }
    }
    if (input.dueAt && !(input.dueAt instanceof Date)) {
      throw new Error('dueAt must be a Date');
    }
  }
}

export function createTrainingAssignmentService(
  deps: TrainingAssignmentDeps
): TrainingAssignmentService {
  return new TrainingAssignmentService(deps);
}
