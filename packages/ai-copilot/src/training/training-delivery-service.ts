/**
 * TrainingDeliveryService — drives the learner-facing side of the adaptive
 * training system. When an assigned employee opens the app, the chat widget
 * calls `getNextTrainingStep(userId, tenantId)`; this service returns the
 * next un-mastered step (or null) and Mr. Mwikila proactively opens a
 * teaching conversation.
 *
 * Progression uses the existing Wave-11 BKT mastery — we never compute
 * mastery here; we only READ `bkt_mastery` via the injected port so the
 * classroom substrate remains the single source of truth.
 *
 * A stall detector flag is exposed for the ambient-brain caller to surface
 * alternative explanations when the learner is idle on a concept.
 */

import type { TrainingRepository } from './training-repository.js';
import type {
  NextTrainingStep,
  TrainingAssignment,
  TrainingDeliveryEvent,
  TrainingDeliveryEventType,
  TrainingPath,
  TrainingPathStep,
} from './training-types.js';
import { TrainingNotFoundError } from './training-types.js';

export interface MasteryPort {
  /**
   * Return p-know per concept for a (tenantId, userId). Values outside
   * [0, 1] will be clamped by callers; missing concepts mean p-know = 0.
   */
  getMastery(
    tenantId: string,
    userId: string
  ): Promise<Readonly<Record<string, number>>>;
}

export interface TrainingDeliveryDeps {
  readonly repo: TrainingRepository;
  readonly mastery: MasteryPort;
  readonly now?: () => Date;
  readonly idFactory?: (prefix: string) => string;
  readonly stallThresholdMs?: number;
}

function defaultId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now()}_${rand}`;
}

function greetingFor(step: TrainingPathStep, path: TrainingPath): string {
  const langHint = path.language === 'sw' ? 'Swahili' : 'English';
  return `Let's continue your training on "${path.title}". Next up: ${step.title}. (${langHint})`;
}

export class TrainingDeliveryService {
  private readonly repo: TrainingRepository;
  private readonly mastery: MasteryPort;
  private readonly now: () => Date;
  private readonly idFactory: (prefix: string) => string;
  private readonly stallMs: number;

  constructor(deps: TrainingDeliveryDeps) {
    this.repo = deps.repo;
    this.mastery = deps.mastery;
    this.now = deps.now ?? (() => new Date());
    this.idFactory = deps.idFactory ?? defaultId;
    this.stallMs = deps.stallThresholdMs ?? 5 * 60 * 1000;
  }

  async getNextTrainingStep(
    tenantId: string,
    userId: string
  ): Promise<NextTrainingStep | null> {
    const assignments = await this.repo.listAssignments(tenantId, {
      assigneeUserId: userId,
    });
    const active = assignments
      .filter((a) => a.status !== 'completed' && a.status !== 'abandoned')
      .sort((a, b) => {
        const aDue = a.dueAt ?? '9999-12-31';
        const bDue = b.dueAt ?? '9999-12-31';
        return aDue.localeCompare(bDue);
      });

    for (const assignment of active) {
      const path = await this.repo.getPath(tenantId, assignment.pathId);
      if (!path) continue;
      const masteryMap = await this.mastery.getMastery(tenantId, userId);
      const next = this.selectNextStep(path, masteryMap);
      if (next) {
        return {
          assignment,
          path,
          step: next,
          greeting: greetingFor(next, path),
        };
      }
      // All steps mastered — mark assignment completed.
      await this.markCompleted(assignment);
    }
    return null;
  }

  async recordDelivery(
    tenantId: string,
    assignmentId: string,
    stepId: string,
    eventType: TrainingDeliveryEventType,
    payload: Readonly<Record<string, unknown>> = {}
  ): Promise<TrainingDeliveryEvent> {
    const assignment = await this.repo.getAssignment(tenantId, assignmentId);
    if (!assignment) {
      throw new TrainingNotFoundError(`assignment ${assignmentId} not found`);
    }
    const event: TrainingDeliveryEvent = {
      id: this.idFactory('tevt'),
      tenantId,
      assignmentId,
      stepId,
      eventType,
      payload,
      occurredAt: this.now().toISOString(),
    };
    await this.repo.appendEvent(event);

    if (eventType === 'step_started' && assignment.status === 'pending') {
      await this.repo.updateAssignment(tenantId, assignmentId, {
        status: 'in_progress',
        lastDeliveredStep: stepId,
      });
    }

    return event;
  }

  /**
   * Refresh the progress percentage on an assignment by reading current
   * mastery. Returns the updated assignment and triggers completion logic
   * if all steps have crossed their mastery thresholds.
   */
  async refreshProgress(
    tenantId: string,
    assignmentId: string
  ): Promise<TrainingAssignment> {
    const assignment = await this.repo.getAssignment(tenantId, assignmentId);
    if (!assignment) {
      throw new TrainingNotFoundError(`assignment ${assignmentId} not found`);
    }
    const path = await this.repo.getPath(tenantId, assignment.pathId);
    if (!path) {
      throw new TrainingNotFoundError('path not found for assignment');
    }
    const masteryMap = await this.mastery.getMastery(
      tenantId,
      assignment.assigneeUserId
    );
    const totalSteps = path.steps.length;
    const mastered = path.steps.filter(
      (s) => (masteryMap[s.conceptId] ?? 0) >= s.masteryThreshold
    ).length;
    const progressPct = totalSteps === 0 ? 0 : mastered / totalSteps;

    if (mastered === totalSteps && totalSteps > 0) {
      return this.markCompleted(assignment);
    }

    return this.repo.updateAssignment(tenantId, assignmentId, {
      status: assignment.status === 'pending' ? 'in_progress' : assignment.status,
      progressPct,
    });
  }

  /**
   * Stall detection — returns true when the last delivery event for this
   * step was more than `stallThresholdMs` ago. Callers can wire this into
   * the ambient-brain to offer an alternative explanation.
   */
  async isStalled(
    tenantId: string,
    assignmentId: string,
    stepId: string
  ): Promise<boolean> {
    const events = await this.repo.listEvents(tenantId, assignmentId);
    const relevant = events.filter((e) => e.stepId === stepId);
    if (relevant.length === 0) return false;
    const latest = relevant[relevant.length - 1];
    const elapsed = this.now().getTime() - new Date(latest.occurredAt).getTime();
    return elapsed > this.stallMs;
  }

  private selectNextStep(
    path: TrainingPath,
    mastery: Readonly<Record<string, number>>
  ): TrainingPathStep | null {
    const sorted = [...path.steps].sort((a, b) => a.orderIndex - b.orderIndex);
    for (const step of sorted) {
      const p = mastery[step.conceptId] ?? 0;
      if (p < step.masteryThreshold) return step;
    }
    return null;
  }

  private async markCompleted(
    assignment: TrainingAssignment
  ): Promise<TrainingAssignment> {
    const updated = await this.repo.updateAssignment(
      assignment.tenantId,
      assignment.id,
      {
        status: 'completed',
        completedAt: this.now().toISOString(),
        progressPct: 1,
      }
    );
    await this.repo.appendEvent({
      id: this.idFactory('tevt'),
      tenantId: assignment.tenantId,
      assignmentId: assignment.id,
      stepId: null,
      eventType: 'path_completed',
      payload: { pathId: assignment.pathId },
      occurredAt: this.now().toISOString(),
    });
    return updated;
  }
}

export function createTrainingDeliveryService(
  deps: TrainingDeliveryDeps
): TrainingDeliveryService {
  return new TrainingDeliveryService(deps);
}
