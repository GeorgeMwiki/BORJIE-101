/**
 * Voyager-style executable code skill library — closes R3 gaps #1 + #3.
 *
 * Reference: Voyager (NVIDIA, Minecraft) — a growing library of executable
 * CODE skills indexed by embeddings IS the agent's long-term procedural
 * memory. No fine-tuning required (pure retrieval + execution).
 *
 * Pattern (R3 §C-E and Part C item 3):
 *   1. MD encounters a new situation.
 *   2. Embedding-search the library for analogous skills (top-3).
 *   3. If any score > RETRIEVAL_THRESHOLD (0.85), retrieve + execute.
 *   4. If all fail, propose composing/extending an existing skill.
 *   5. Successful skills accumulate `success_count` → become first-pick.
 *   6. Skills with 3 consecutive failures auto-quarantine.
 *
 * The skill code runs against the J1 IEntityStoreService contract for I/O.
 * No global state — every skill takes an entity-store handle and a
 * jurisdiction-tagged input bundle, returns a typed result.
 */

import type { IEntityStoreService } from './entity-store-port.js';

/** Threshold for "retrieve and execute" (R3 §C). */
export const RETRIEVAL_THRESHOLD = 0.85 as const;
/** Threshold for "compose with existing skill" — lower bar than retrieve. */
export const COMPOSITION_THRESHOLD = 0.6 as const;
/** Consecutive failures before a skill auto-quarantines. */
export const FAILURE_QUARANTINE_LIMIT = 3 as const;

/** A code skill = NL description + embedding + executable code. */
export interface CodeSkill<TInput = unknown, TOutput = unknown> {
  /** Stable slug. */
  readonly id: string;
  readonly name: string;
  /** NL description used for both retrieval and human readability. */
  readonly description: string;
  /** Embedding vector. Float[] in [-1, 1]. Cosine-similarity compared. */
  readonly embedding: ReadonlyArray<number>;
  /** The executable code — see SerializableFunction below. */
  readonly code: SerializableFunction<TInput, TOutput>;
  /**
   * Jurisdiction binding. `'platform'` for jurisdiction-neutral; otherwise
   * a tenant jurisdiction code (e.g. `'KE'`, `'TZ'`, `'UG'`). The library
   * refuses to execute a `'KE'` skill against a `'TZ'` tenant.
   */
  readonly jurisdiction: 'platform' | string;
  /**
   * When this skill was last invoked. Used for stale-skill pruning.
   * ISO-8601 string for determinism in tests.
   */
  readonly last_used_at?: string;
  /** Count of successful invocations (`status === 'ok'`). */
  readonly success_count: number;
  /** Count of failed invocations (`status === 'error'`). */
  readonly failure_count: number;
  /**
   * Count of CONSECUTIVE failures since the last success. Resets to 0 on
   * any successful run. Hits `FAILURE_QUARANTINE_LIMIT` => quarantined.
   */
  readonly consecutive_failures: number;
  /** Quarantined skills are skipped during retrieval. */
  readonly quarantined: boolean;
}

/**
 * A serializable function — wraps a TS function PLUS its NL description
 * + source string so it can be persisted (e.g. round-trip through a
 * skills DB) and re-instantiated. For the in-memory library, we hold the
 * concrete TS function as `run`; the `source` is informational.
 */
export interface SerializableFunction<TInput = unknown, TOutput = unknown> {
  /** Display-only source snippet. */
  readonly source: string;
  /** Inputs the skill expects, as a JSON schema fragment. */
  readonly input_schema: Readonly<Record<string, unknown>>;
  /** Output the skill produces, as a JSON schema fragment. */
  readonly output_schema: Readonly<Record<string, unknown>>;
  /**
   * Actual runtime entrypoint. Receives the skill execution context
   * (entity-store handle + jurisdiction + tenantId + correlation id) and
   * the caller-supplied typed input; returns the typed output.
   */
  readonly run: (ctx: SkillExecutionContext, input: TInput) => Promise<TOutput>;
}

export interface SkillExecutionContext {
  readonly entity_store: IEntityStoreService;
  readonly tenant_id: string;
  readonly jurisdiction: string;
  readonly correlation_id: string;
  /** ISO-8601 timestamp injected by the executor for deterministic tests. */
  readonly now: string;
}

export interface SkillSituation {
  /** Natural-language description of what's happening. */
  readonly description: string;
  /** Pre-computed embedding for the situation. */
  readonly embedding: ReadonlyArray<number>;
  /** Jurisdiction context for execution. */
  readonly jurisdiction: string;
  /** Tenant under which the skill will execute. */
  readonly tenant_id: string;
}

export interface RetrievedSkill<TInput = unknown, TOutput = unknown> {
  readonly skill: CodeSkill<TInput, TOutput>;
  /** Cosine-similarity score in [0, 1]. */
  readonly score: number;
}

export interface SkillExecutionResult<TOutput = unknown> {
  readonly skill_id: string;
  readonly status: 'ok' | 'error';
  readonly output: TOutput | null;
  readonly error?: { code: string; message: string };
  readonly duration_ms: number;
  readonly correlation_id: string;
}

/**
 * "Learn by example" trace: input + expected output + commentary captured
 * during manual operation. 1-3 traces become the seed for compiling a new
 * code skill via the LLM (the "learn by example" path described in the
 * Voyager paper as auto-curriculum).
 */
export interface SkillTrace {
  readonly input: unknown;
  readonly expected_output: unknown;
  readonly commentary?: string;
}
