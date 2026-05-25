/**
 * Public types for the Piece H Socratic tutor.
 *
 * The state machine drives a lesson through:
 *   1. assess     — gauge prior knowledge
 *   2. explain    — micro-explanation grounded in tenant data
 *   3. check      — verify understanding
 *   4. adapt      — branch on right / wrong / "I don't get it"
 *   5. mastery    — record the outcome, unlock next concept
 *
 * Concepts live in the database table `tutoring_skill_pack` (migration
 * 0210). The package mirrors the row shape so consumers can build a
 * lesson without a DB connection (tests / dev mode).
 */

export interface TutoringWorkedExample {
  readonly prompt: string;
  readonly answer: string;
  readonly explanation: string;
  readonly citation_keys: readonly string[];
}

export interface TutoringCheckUnderstanding {
  readonly question: string;
  /** Regex pattern matched case-insensitively against the learner's answer. */
  readonly expected_pattern: string;
  readonly hint: string;
}

export interface TutoringContent {
  readonly hook: string;
  readonly definition: string;
  readonly formula: string | null;
  readonly worked_example: TutoringWorkedExample;
  readonly common_mistakes: readonly string[];
  readonly check_understanding: readonly TutoringCheckUnderstanding[];
}

export interface TutoringMasteryThresholds {
  readonly beginner: { readonly min_correct: number };
  readonly intermediate: {
    readonly min_correct: number;
    readonly window?: number;
  };
  readonly advanced: {
    readonly min_correct: number;
    readonly window?: number;
  };
}

export interface TutoringDataBinding {
  /** Repository / data-provider key. */
  readonly source: string;
  /** Inputs to the data-source call. */
  readonly inputs: Readonly<Record<string, unknown>>;
  /** Map of placeholder key → JSONPath expression on the response. */
  readonly placeholders: Readonly<Record<string, string>>;
}

export interface TutoringConcept {
  readonly id: string;
  readonly tenantId: string | null;
  readonly conceptSlug: string;
  readonly displayNameEn: string;
  readonly displayNameSw: string | null;
  readonly description: string | null;
  readonly prerequisiteConcepts: readonly string[];
  readonly masteryThresholds: TutoringMasteryThresholds;
  readonly content: TutoringContent;
  readonly dataBinding: TutoringDataBinding | null;
}

/** Citation back to the source data row for any number used in a lesson. */
export interface DataCitation {
  /** Placeholder key from the data-binding (e.g. "gross_income"). */
  readonly key: string;
  /** The resolved value substituted into the example. */
  readonly value: unknown;
  /** Opaque identifier of the underlying row (e.g. a ledger entry id). */
  readonly sourceRef: string;
}

export interface LessonState {
  readonly tenantId: string;
  readonly userId: string;
  readonly conceptSlug: string;
  readonly locale: 'en' | 'sw';
  readonly step:
    | 'assess'
    | 'hook'
    | 'explain'
    | 'worked_example'
    | 'check_understanding'
    | 'remediate'
    | 'mastery'
    | 'complete';
  readonly checkIndex: number;
  readonly attempts: number;
  readonly correctCount: number;
  readonly incorrectCount: number;
  readonly citations: readonly DataCitation[];
}

export interface LessonEvent {
  /** Step that produced this event. */
  readonly step: LessonState['step'];
  /** Message to display to the learner. */
  readonly message: string;
  /** Whether the lesson expects a learner reply next. */
  readonly waitingForLearner: boolean;
  /** Optional citations attached to this step. */
  readonly citations?: readonly DataCitation[];
}

export interface LessonEngineDeps {
  readonly conceptStore: ConceptStore;
  readonly dataAdapter: TutoringDataAdapter;
  readonly masteryRecorder?: MasteryRecorder;
}

/** Adapter: how the lesson orchestrator loads concept rows. */
export interface ConceptStore {
  readonly findBySlug: (input: {
    readonly tenantId: string;
    readonly conceptSlug: string;
  }) => Promise<TutoringConcept | null>;
}

/** Adapter: how the lesson pulls tenant data into the worked example. */
export interface TutoringDataAdapter {
  readonly resolve: (input: {
    readonly tenantId: string;
    readonly binding: TutoringDataBinding;
  }) => Promise<{
    readonly values: Readonly<Record<string, unknown>>;
    readonly citations: readonly DataCitation[];
  }>;
}

/**
 * Optional bridge to the chat-ui MasteryGate / user_action_tracker.
 * If absent, the orchestrator runs a single-pass lesson with no
 * mastery progression — useful as a fallback in services that don't
 * import the chat-ui package.
 */
export interface MasteryRecorder {
  readonly record: (input: {
    readonly tenantId: string;
    readonly userId: string;
    readonly conceptSlug: string;
    readonly outcome: 'correct' | 'incorrect';
  }) => Promise<void>;
}

/** Lesson run input. */
export interface RunLessonInput {
  readonly tenantId: string;
  readonly userId: string;
  readonly conceptSlug: string;
  readonly locale?: 'en' | 'sw';
}

/** Thrown when a lesson cannot start. */
export class TutoringEngineError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'CONCEPT_NOT_FOUND'
      | 'DATA_BINDING_FAILURE'
      | 'INVALID_STATE',
    public override readonly cause?: unknown,
  ) {
    super(message, { cause });
    this.name = 'TutoringEngineError';
  }
}
