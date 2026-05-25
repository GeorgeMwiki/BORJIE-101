/**
 * Reflexion types — Phase E gap-closure (P8 Gap 7).
 *
 * Implements the CoT → eval → lesson → next-turn-prompt feedback loop
 * described by Shinn et al. 2023 ("Reflexion: Language Agents with Verbal
 * Reinforcement Learning", arXiv:2303.11366). The distill stage already
 * captures chain-of-thought traces into `kernel_cot_reservoir`. The
 * reflexion modules consume those traces + the eval/judge verdict and
 * emit short imperative "lessons" that are prepended to the next turn's
 * system prompt for the same tenant + task tag.
 *
 * Every type here is immutable. The store contract is a narrow port so
 * the in-memory implementation can be swapped for a Postgres-backed
 * adapter later without touching the distiller, renderer, or callers.
 */

/**
 * A single recorded step of the model's chain-of-thought. The distill
 * stage already strips PII before persisting; reflexion treats traces
 * as opaque text blobs and never re-introduces raw user input.
 */
export interface CotStep {
  readonly index: number;
  readonly thought: string;
  /** Optional tool call name + brief argument summary. */
  readonly tool?: string;
  /** Optional observation returned by the tool / environment. */
  readonly observation?: string;
}

export interface CotTrace {
  readonly traceId: string;
  readonly tenantId: string;
  readonly taskTag: string;
  readonly steps: ReadonlyArray<CotStep>;
  /** ISO-8601. */
  readonly capturedAt: string;
}

/** Coarse outcome label attached to the turn. */
export type TurnOutcome = 'success' | 'failure' | 'partial' | 'uneventful';

export interface TurnOutcomeRecord {
  readonly outcome: TurnOutcome;
  /** Free-text observation captured post-hoc (e.g. tool error message). */
  readonly observation?: string;
}

/**
 * Verdict from the eval/judge layer. `score` is 0..1 — anything below
 * the `JUDGE_LESSON_THRESHOLD` triggers a lesson even on otherwise
 * "successful" turns (a 0.6-rated success is still teaching material).
 */
export interface JudgeVerdict {
  readonly score: number;
  readonly verdict: 'pass' | 'fail' | 'mixed';
  /** Optional one-line judge rationale. */
  readonly rationale?: string;
}

/**
 * The distilled lesson. Designed to be cheap to embed in a system
 * prompt: short, imperative, free of PII, scoped to a tenant + task
 * tag. `evidence` is a short pointer back to the originating trace so
 * operators can audit a lesson without dragging the raw CoT into the
 * prompt window.
 */
export interface Lesson {
  readonly id: string;
  readonly tenantId: string;
  readonly taskTag: string;
  /** Short imperative sentence (max LESSON_MAX_CHARS). */
  readonly lesson: string;
  /** Short reference: e.g. `trace:abc / step 3 / tool=search`. */
  readonly evidence: string;
  /** ISO-8601 creation time. */
  readonly createdAt: string;
  /**
   * Composite score used by the renderer for LRU eviction. Higher =
   * more salient. Combines recency + judge severity + repeat count.
   * Bounded to [0, 1].
   */
  readonly recencyScore: number;
}

/**
 * Narrow port for lesson persistence. In-memory implementation lives
 * in `lesson-store.ts`; a Drizzle-backed adapter is a follow-up (Wave-M).
 */
export interface LessonStore {
  /**
   * Insert a new lesson. Implementations MAY deduplicate against a
   * recent identical-text lesson for the same `(tenantId, taskTag)` —
   * the in-memory impl does so by bumping `recencyScore` rather than
   * storing the duplicate.
   */
  put(lesson: Lesson): Promise<Lesson>;
  /**
   * Return up to `limit` lessons for a tenant + task tag, ordered by
   * `recencyScore` descending. Used by the renderer; bounded to keep
   * the prompt fragment small.
   */
  recent(
    tenantId: string,
    taskTag: string,
    limit: number,
  ): Promise<ReadonlyArray<Lesson>>;
  /** Test-only: clear all lessons. */
  clear(): Promise<void>;
}

/**
 * Configuration for the renderer. All fields optional; sensible defaults
 * live in `lesson-renderer.ts` so callers can `renderLessons(store, ...)
 * ` without juggling knobs.
 */
export interface RendererOptions {
  /**
   * Soft cap on the rendered fragment's token count (approximate, via
   * a 4-chars-per-token heuristic — kernel callers wrap with an exact
   * tokenizer if they need precision). Default 600.
   */
  readonly maxTokens?: number;
  /**
   * Hard cap on number of lessons to consider before token budgeting.
   * Default 12.
   */
  readonly maxLessons?: number;
}

// ---------------------------------------------------------------------------
// Constants — exported so callers can compose without re-deriving.
// ---------------------------------------------------------------------------

/** Max characters in a single lesson sentence. Keeps prompts cheap. */
export const LESSON_MAX_CHARS = 240;

/** Default token cap for the rendered system-prompt fragment. */
export const DEFAULT_MAX_TOKENS = 600;

/** Default max lessons to consider per render. */
export const DEFAULT_MAX_LESSONS = 12;

/**
 * Judge-score ceiling below which a "success" still produces a lesson.
 * A 0.55 score on a pass is treated as teaching material.
 */
export const JUDGE_LESSON_THRESHOLD = 0.7;

/** Approximate chars-per-token used by the renderer's bounded fragment. */
export const CHARS_PER_TOKEN = 4;
