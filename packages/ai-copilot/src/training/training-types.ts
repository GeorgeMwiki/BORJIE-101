/**
 * Adaptive training — shared types.
 *
 * The admin-driven adaptive training system replaces the classroom/course
 * mental model. Admins describe needs in natural language; Mr. Mwikila
 * generates a training path on demand, and the existing Wave-11 BKT tracks
 * mastery across concepts as the learner interacts with the chat widget.
 */

export type TrainingAudience =
  | 'station-masters'
  | 'estate-officers'
  | 'caretakers'
  | 'accountants'
  | 'owners'
  | 'tenants'
  | 'custom';

export type TrainingLanguage = 'en' | 'sw' | 'both';

export type TrainingStepKind =
  | 'lesson'
  | 'scenario'
  | 'quiz'
  | 'handout'
  | 'roleplay'
  | 'reflection';

export type TrainingAssignmentStatus =
  | 'pending'
  | 'in_progress'
  | 'completed'
  | 'abandoned'
  | 'reassigned';

export type TrainingDeliveryEventType =
  | 'step_started'
  | 'answer_submitted'
  | 'concept_mastered'
  | 'stuck'
  | 'continued'
  | 'path_completed';

export type MasteryMap = Readonly<Record<string, number>>;

export interface TrainingStepContent {
  readonly socraticPrompts: readonly string[];
  readonly scenario?: string;
  readonly handoutMarkdown?: string;
  readonly checkpointQuestion?: string;
  readonly expectedAnswer?: string;
}

export interface TrainingPathStep {
  readonly id: string;
  readonly pathId: string;
  readonly orderIndex: number;
  readonly conceptId: string;
  readonly kind: TrainingStepKind;
  readonly title: string;
  readonly content: TrainingStepContent;
  readonly masteryThreshold: number;
  readonly estimatedMinutes: number;
}

export interface TrainingPath {
  readonly id: string;
  readonly tenantId: string;
  readonly title: string;
  readonly topic: string;
  readonly audience: TrainingAudience;
  readonly language: TrainingLanguage;
  readonly durationMinutes: number;
  readonly conceptIds: readonly string[];
  readonly summary: string;
  readonly generatedBy: string;
  readonly steps: readonly TrainingPathStep[];
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly deletedAt?: string | null;
}

export interface TrainingAssignment {
  readonly id: string;
  readonly tenantId: string;
  readonly pathId: string;
  readonly assigneeUserId: string;
  readonly assignedBy: string;
  readonly assignedAt: string;
  readonly dueAt?: string | null;
  readonly status: TrainingAssignmentStatus;
  readonly completedAt?: string | null;
  readonly progressPct: number;
  readonly lastDeliveredStep?: string | null;
}

export interface TrainingDeliveryEvent {
  readonly id: string;
  readonly tenantId: string;
  readonly assignmentId: string;
  readonly stepId?: string | null;
  readonly eventType: TrainingDeliveryEventType;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly occurredAt: string;
}

export interface NextTrainingStep {
  readonly assignment: TrainingAssignment;
  readonly path: TrainingPath;
  readonly step: TrainingPathStep;
  readonly greeting: string;
}

export interface GenerateTrainingPathOpts {
  readonly topic: string;
  readonly audience: TrainingAudience;
  readonly durationHours: number;
  readonly language: TrainingLanguage;
  readonly priorMastery?: MasteryMap;
  readonly tenantId: string;
  readonly createdBy: string;
}

export interface AssignTrainingInput {
  readonly pathId: string;
  readonly tenantId: string;
  readonly assigneeUserIds: readonly string[];
  readonly dueAt?: Date | null;
  readonly assignedBy: string;
}

export interface PathEditInput {
  readonly title?: string;
  readonly summary?: string;
  readonly durationMinutes?: number;
  readonly steps?: readonly {
    readonly conceptId: string;
    readonly kind: TrainingStepKind;
    readonly title: string;
    readonly content: TrainingStepContent;
    readonly masteryThreshold?: number;
    readonly estimatedMinutes?: number;
  }[];
}

export class TrainingDisabledError extends Error {
  public readonly code = 'TRAINING_DISABLED' as const;
  constructor(message = 'Training feature is disabled for this tenant') {
    super(message);
    this.name = 'TrainingDisabledError';
  }
}

export class TenantMismatchError extends Error {
  public readonly code = 'TENANT_MISMATCH' as const;
  constructor(message = 'Resource belongs to a different tenant') {
    super(message);
    this.name = 'TenantMismatchError';
  }
}

export class TrainingNotFoundError extends Error {
  public readonly code = 'NOT_FOUND' as const;
  constructor(message = 'Training resource not found') {
    super(message);
    this.name = 'TrainingNotFoundError';
  }
}
