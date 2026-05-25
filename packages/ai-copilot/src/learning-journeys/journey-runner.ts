/**
 * Journey Runner — stateful tracking for a user's progress through a journey.
 *
 * Pure immutable state transitions. Callers persist snapshots elsewhere.
 * Tenant isolation is enforced by always requiring (tenantId, userId) on every
 * call; the runner refuses to transition a snapshot across tenants.
 */

import type {
  JourneyDefinition,
  JourneyProgressSnapshot,
  JourneyRunnerEvent,
  JourneyStep,
  StepProgress,
  StepStatus,
} from './journey-ui-types.js';
import { getJourney, getStep } from './journey-registry.js';

export class JourneyRunnerError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'JOURNEY_NOT_FOUND'
      | 'STEP_NOT_FOUND'
      | 'PREREQUISITE_NOT_MET'
      | 'TENANT_MISMATCH'
      | 'ALREADY_COMPLETED'
      | 'MAX_ATTEMPTS_REACHED'
      | 'STEP_BLOCKED',
  ) {
    super(message);
    this.name = 'JourneyRunnerError';
  }
}

export interface StartJourneyInput {
  readonly tenantId: string;
  readonly userId: string;
  readonly journeyId: string;
  readonly now: string;
}

export interface AdvanceStepInput {
  readonly snapshot: JourneyProgressSnapshot;
  readonly stepId: string;
  readonly tenantId: string;
  readonly now: string;
  readonly score?: number;
  readonly notes?: string;
}

export interface EnterStepInput {
  readonly snapshot: JourneyProgressSnapshot;
  readonly stepId: string;
  readonly tenantId: string;
  readonly now: string;
}

function emptyStepProgress(stepId: string): StepProgress {
  return {
    stepId,
    status: 'locked',
    attemptsUsed: 0,
  };
}

function buildInitialProgress(
  journey: JourneyDefinition,
): Record<string, StepProgress> {
  const progress: Record<string, StepProgress> = {};
  for (const step of journey.steps) {
    const unlocked = step.prerequisites.length === 0;
    progress[step.id] = {
      stepId: step.id,
      status: unlocked ? 'unlocked' : 'locked',
      attemptsUsed: 0,
    };
  }
  return progress;
}

function areAllPrereqsCompleted(
  step: JourneyStep,
  progress: Readonly<Record<string, StepProgress>>,
): boolean {
  return step.prerequisites.every(
    (prereqId) => progress[prereqId]?.status === 'completed',
  );
}

function unlockWaitingSteps(
  journey: JourneyDefinition,
  progress: Readonly<Record<string, StepProgress>>,
): Record<string, StepProgress> {
  const next: Record<string, StepProgress> = { ...progress };
  for (const step of journey.steps) {
    const current = next[step.id];
    if (!current) continue;
    if (current.status === 'locked' && areAllPrereqsCompleted(step, next)) {
      next[step.id] = {
        ...current,
        status: 'unlocked',
      };
    }
  }
  return next;
}

export function startJourney(
  input: StartJourneyInput,
): { snapshot: JourneyProgressSnapshot; events: readonly JourneyRunnerEvent[] } {
  const journey = getJourney(input.journeyId);
  if (!journey) {
    throw new JourneyRunnerError(
      `Journey ${input.journeyId} not found`,
      'JOURNEY_NOT_FOUND',
    );
  }
  const stepProgress = buildInitialProgress(journey);
  const firstUnlocked = journey.steps.find(
    (s) => stepProgress[s.id]?.status === 'unlocked',
  );
  const snapshot: JourneyProgressSnapshot = {
    tenantId: input.tenantId,
    userId: input.userId,
    journeyId: journey.id,
    currentStepId: firstUnlocked?.id,
    stepProgress,
    startedAt: input.now,
    lastActivityAt: input.now,
  };
  return {
    snapshot,
    events: [{ kind: 'journey-started', journeyId: journey.id }],
  };
}

export function enterStep(
  input: EnterStepInput,
): { snapshot: JourneyProgressSnapshot; events: readonly JourneyRunnerEvent[] } {
  if (input.snapshot.tenantId !== input.tenantId) {
    throw new JourneyRunnerError('Tenant mismatch', 'TENANT_MISMATCH');
  }
  if (input.snapshot.completedAt) {
    throw new JourneyRunnerError('Journey already completed', 'ALREADY_COMPLETED');
  }
  const step = getStep(input.snapshot.journeyId, input.stepId);
  if (!step) {
    throw new JourneyRunnerError(`Step ${input.stepId} not found`, 'STEP_NOT_FOUND');
  }
  const current = input.snapshot.stepProgress[input.stepId];
  if (!current) {
    throw new JourneyRunnerError(`Step ${input.stepId} not tracked`, 'STEP_NOT_FOUND');
  }
  if (current.status === 'locked') {
    throw new JourneyRunnerError(
      `Prerequisites not met for ${input.stepId}`,
      'PREREQUISITE_NOT_MET',
    );
  }
  if (current.status === 'completed') {
    return { snapshot: input.snapshot, events: [] };
  }
  const updated: StepProgress = {
    ...current,
    status: 'in-progress',
    startedAt: current.startedAt ?? input.now,
  };
  const snapshot: JourneyProgressSnapshot = {
    ...input.snapshot,
    currentStepId: input.stepId,
    stepProgress: {
      ...input.snapshot.stepProgress,
      [input.stepId]: updated,
    },
    lastActivityAt: input.now,
  };
  return {
    snapshot,
    events: [{ kind: 'step-entered', stepId: input.stepId }],
  };
}

export function completeStep(
  input: AdvanceStepInput,
): { snapshot: JourneyProgressSnapshot; events: readonly JourneyRunnerEvent[] } {
  if (input.snapshot.tenantId !== input.tenantId) {
    throw new JourneyRunnerError('Tenant mismatch', 'TENANT_MISMATCH');
  }
  if (input.snapshot.completedAt) {
    throw new JourneyRunnerError('Journey already completed', 'ALREADY_COMPLETED');
  }
  const journey = getJourney(input.snapshot.journeyId);
  if (!journey) {
    throw new JourneyRunnerError(
      `Journey ${input.snapshot.journeyId} not found`,
      'JOURNEY_NOT_FOUND',
    );
  }
  const step = getStep(journey.id, input.stepId);
  if (!step) {
    throw new JourneyRunnerError(`Step ${input.stepId} not found`, 'STEP_NOT_FOUND');
  }
  const current = input.snapshot.stepProgress[input.stepId];
  if (!current) {
    throw new JourneyRunnerError(`Step ${input.stepId} not tracked`, 'STEP_NOT_FOUND');
  }
  if (current.status === 'locked') {
    throw new JourneyRunnerError(
      `Prerequisites not met for ${input.stepId}`,
      'PREREQUISITE_NOT_MET',
    );
  }
  const updated: StepProgress = {
    ...current,
    status: 'completed',
    attemptsUsed: current.attemptsUsed + 1,
    completedAt: input.now,
    score: input.score,
    notes: input.notes,
  };
  const nextProgress: Record<string, StepProgress> = {
    ...input.snapshot.stepProgress,
    [input.stepId]: updated,
  };
  const unlocked = unlockWaitingSteps(journey, nextProgress);
  const allRequiredDone = journey.steps
    .filter((s) => s.required)
    .every((s) => unlocked[s.id]?.status === 'completed');
  const nextUnlockedStep = journey.steps.find(
    (s) => unlocked[s.id]?.status === 'unlocked' || unlocked[s.id]?.status === 'in-progress',
  );
  const snapshot: JourneyProgressSnapshot = {
    ...input.snapshot,
    currentStepId: nextUnlockedStep?.id,
    stepProgress: unlocked,
    lastActivityAt: input.now,
    completedAt: allRequiredDone ? input.now : undefined,
  };
  const events: JourneyRunnerEvent[] = [
    { kind: 'step-completed', stepId: input.stepId, score: input.score },
  ];
  if (allRequiredDone) {
    events.push({ kind: 'journey-completed', journeyId: journey.id });
  }
  return { snapshot, events };
}

export function failStep(
  input: AdvanceStepInput & { reason: string },
): { snapshot: JourneyProgressSnapshot; events: readonly JourneyRunnerEvent[] } {
  if (input.snapshot.tenantId !== input.tenantId) {
    throw new JourneyRunnerError('Tenant mismatch', 'TENANT_MISMATCH');
  }
  const step = getStep(input.snapshot.journeyId, input.stepId);
  if (!step) {
    throw new JourneyRunnerError(`Step ${input.stepId} not found`, 'STEP_NOT_FOUND');
  }
  const current = input.snapshot.stepProgress[input.stepId];
  if (!current) {
    throw new JourneyRunnerError(`Step ${input.stepId} not tracked`, 'STEP_NOT_FOUND');
  }
  const newAttempts = current.attemptsUsed + 1;
  const maxAttempts = step.kind === 'quiz' ? step.maxAttempts : 3;
  const status: StepStatus =
    newAttempts >= maxAttempts ? 'failed' : 'in-progress';
  const updated: StepProgress = {
    ...current,
    status,
    attemptsUsed: newAttempts,
    notes: input.notes ?? input.reason,
  };
  const snapshot: JourneyProgressSnapshot = {
    ...input.snapshot,
    stepProgress: {
      ...input.snapshot.stepProgress,
      [input.stepId]: updated,
    },
    lastActivityAt: input.now,
  };
  return {
    snapshot,
    events: [{ kind: 'step-failed', stepId: input.stepId, reason: input.reason }],
  };
}

export function resumeJourney(
  snapshot: JourneyProgressSnapshot,
  tenantId: string,
): JourneyProgressSnapshot {
  if (snapshot.tenantId !== tenantId) {
    throw new JourneyRunnerError('Tenant mismatch', 'TENANT_MISMATCH');
  }
  if (snapshot.completedAt) return snapshot;
  const journey = getJourney(snapshot.journeyId);
  if (!journey) {
    throw new JourneyRunnerError(
      `Journey ${snapshot.journeyId} not found`,
      'JOURNEY_NOT_FOUND',
    );
  }
  const resumed = unlockWaitingSteps(journey, snapshot.stepProgress);
  const firstInProgress = journey.steps.find(
    (s) => resumed[s.id]?.status === 'in-progress',
  );
  const firstUnlocked = journey.steps.find(
    (s) => resumed[s.id]?.status === 'unlocked',
  );
  return {
    ...snapshot,
    currentStepId: firstInProgress?.id ?? firstUnlocked?.id ?? snapshot.currentStepId,
    stepProgress: resumed,
  };
}

export function calculateCompletionPercent(
  snapshot: JourneyProgressSnapshot,
): number {
  const journey = getJourney(snapshot.journeyId);
  if (!journey) return 0;
  const total = journey.steps.length;
  if (total === 0) return 0;
  const completed = journey.steps.filter(
    (s) => snapshot.stepProgress[s.id]?.status === 'completed',
  ).length;
  return Math.round((completed / total) * 100);
}
