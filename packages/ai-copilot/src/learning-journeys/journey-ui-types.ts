/**
 * Learning Journeys UI types — Wave-12 port from LitFin.
 *
 * Estate-management translation of LitFin's borrower journey. A journey is a
 * named, multi-step onboarding or training flow (admin onboarding, property
 * owner onboarding, tenant onboarding, estate officer training, migration
 * wizard, compliance setup). Each step is typed for its dispatched UI surface.
 *
 * Pure types only — no I/O, no singletons.
 */

export type JourneyAudience =
  | 'admin'
  | 'property-owner'
  | 'tenant'
  | 'estate-officer'
  | 'station-master'
  | 'migration'
  | 'compliance';

export type StepKind =
  | 'video'
  | 'reading'
  | 'quiz'
  | 'hands-on-task'
  | 'ai-conversation';

export type StepStatus =
  | 'locked'
  | 'unlocked'
  | 'in-progress'
  | 'completed'
  | 'skipped'
  | 'failed';

export interface JourneyBaseStep {
  readonly id: string;
  readonly kind: StepKind;
  readonly titleEn: string;
  readonly titleSw: string;
  readonly descriptionEn: string;
  readonly descriptionSw: string;
  readonly expectedMinutes: number;
  /** Concept IDs from classroom/concepts-catalog this step teaches. */
  readonly conceptIds: readonly string[];
  /** Step IDs that must be completed before this step unlocks. */
  readonly prerequisites: readonly string[];
  /** If true, journey cannot be marked complete until this step is done. */
  readonly required: boolean;
}

export interface VideoStep extends JourneyBaseStep {
  readonly kind: 'video';
  readonly videoRef: string;
  readonly durationSeconds: number;
  readonly transcriptRef?: string;
}

export interface ReadingStep extends JourneyBaseStep {
  readonly kind: 'reading';
  readonly contentMdRef: string;
  readonly estimatedWordCount: number;
}

export interface QuizStep extends JourneyBaseStep {
  readonly kind: 'quiz';
  readonly questionIds: readonly string[];
  readonly passingScore: number;
  readonly maxAttempts: number;
}

export interface HandsOnTaskStep extends JourneyBaseStep {
  readonly kind: 'hands-on-task';
  readonly taskRef: string;
  readonly successCriteria: readonly string[];
  readonly blockOnCompletion: boolean;
}

export interface AiConversationStep extends JourneyBaseStep {
  readonly kind: 'ai-conversation';
  readonly personaId: string;
  readonly openingPromptEn: string;
  readonly openingPromptSw: string;
  readonly evaluationRubric: readonly string[];
}

export type JourneyStep =
  | VideoStep
  | ReadingStep
  | QuizStep
  | HandsOnTaskStep
  | AiConversationStep;

export interface JourneyDefinition {
  readonly id: string;
  readonly version: string;
  readonly audience: JourneyAudience;
  readonly titleEn: string;
  readonly titleSw: string;
  readonly summaryEn: string;
  readonly summarySw: string;
  readonly totalExpectedMinutes: number;
  readonly steps: readonly JourneyStep[];
  readonly countryScopes: readonly string[];
}

export interface StepProgress {
  readonly stepId: string;
  readonly status: StepStatus;
  readonly attemptsUsed: number;
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly score?: number;
  readonly notes?: string;
}

export interface JourneyProgressSnapshot {
  readonly tenantId: string;
  readonly userId: string;
  readonly journeyId: string;
  readonly currentStepId?: string;
  readonly stepProgress: Readonly<Record<string, StepProgress>>;
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly lastActivityAt: string;
}

export type JourneyRunnerEvent =
  | { readonly kind: 'journey-started'; readonly journeyId: string }
  | { readonly kind: 'step-entered'; readonly stepId: string }
  | { readonly kind: 'step-completed'; readonly stepId: string; readonly score?: number }
  | { readonly kind: 'step-failed'; readonly stepId: string; readonly reason: string }
  | { readonly kind: 'journey-completed'; readonly journeyId: string };
