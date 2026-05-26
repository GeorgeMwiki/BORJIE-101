/**
 * Persistent Memory + Skill Library — public type surface (Wave 18GG).
 *
 * Companion to `docs/DESIGN/MEMORY_AMNESIA_PREVENTION_SOTA.md`. Every
 * type here is immutable. Records are never mutated in place —
 * transitions (e.g. `observed → tested → canonical → deprecated` for
 * skills) produce new projections via dedicated handlers. This
 * mirrors the immutability discipline used across the Borjie
 * codebase (see coding-style.md).
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Tunable constants
// ---------------------------------------------------------------------------

/** Default sliding-TTL for `session_memory`. Refreshed at every turn. */
export const SESSION_MEMORY_TTL_DAYS = 30;

/** Default number of turns retained in the session-memory rolling window. */
export const SESSION_RECENT_TURNS = 6;

/** Skill decay window — unused skills are deprecated after this many days. */
export const SKILL_DECAY_DAYS = 180;

/** Minimum invocations before a skill becomes a Skill candidate. */
export const SKILL_COMPOSE_MIN_INVOCATIONS = 3;

/** Minimum success_rate before a skill is promoted to `tested`. */
export const SKILL_PROMOTE_MIN_SUCCESS_RATE = 0.8;

/** Default working-memory budget before summarisation triggers (tokens). */
export const SUMMARISE_BUDGET_TOKENS = 700_000;

/** Default chunk size for a single summarised block (tokens). */
export const SUMMARISE_BLOCK_TOKENS = 200_000;

// ---------------------------------------------------------------------------
// Session memory — short-term tier
// ---------------------------------------------------------------------------

export interface ActiveDecision {
  readonly id: string;
  readonly decided_at: string;
  readonly summary: string;
  readonly owner: 'mr-mwikila' | 'user';
}

export interface PendingQuestion {
  readonly id: string;
  readonly asked_at: string;
  readonly question: string;
  readonly expected_answer_kind: 'text' | 'number' | 'choice' | 'approval';
}

export interface SessionMemory {
  readonly id: string;
  readonly tenant_id: string;
  readonly session_id: string;
  readonly user_id: string;
  readonly thread_id: string;
  readonly summary_md: string;
  readonly active_decisions: ReadonlyArray<ActiveDecision>;
  readonly pending_questions: ReadonlyArray<PendingQuestion>;
  readonly last_turn_at: string;
  readonly expires_at: string;
  readonly audit_hash: string;
}

// ---------------------------------------------------------------------------
// Procedural memory — skills (Voyager-style)
// ---------------------------------------------------------------------------

export const SKILL_STATUSES = [
  'observed',
  'tested',
  'canonical',
  'deprecated',
] as const;

export type SkillStatus = (typeof SKILL_STATUSES)[number];

export const PENDING_KINDS = [
  'decision',
  'approval',
  'data_request',
  'follow_up',
] as const;

export type PendingKind = (typeof PENDING_KINDS)[number];

export interface Precondition {
  readonly kind: 'has_capability' | 'has_data' | 'has_approval' | 'has_skill';
  readonly identifier: string;
}

export interface Postcondition {
  readonly kind: 'wrote_artifact' | 'recorded_mutation' | 'sent_message';
  readonly identifier: string;
}

export interface RetryPolicy {
  readonly max_attempts: number;
  readonly backoff_ms: number;
  readonly on_failure: 'abort' | 'continue' | 'fallback_skill';
  readonly fallback_skill_id?: string;
}

export interface SkillStep {
  readonly seq: number;
  /** Either a tool_id ('cap:compose_doc') or a nested skill_id ('skl:kyb_lookup'). */
  readonly tool_or_skill: string;
  readonly input_template: Record<string, unknown>;
  /** Captured zod JSON shape (deserialised by callers when needed). */
  readonly expected_output_schema: unknown;
  readonly retry_policy: RetryPolicy;
}

export interface Skill {
  readonly id: string;
  readonly version: number;
  readonly tenant_id: string;
  readonly scope_id: string;
  readonly intent: string;
  readonly preconditions: ReadonlyArray<Precondition>;
  readonly steps: ReadonlyArray<SkillStep>;
  readonly postconditions: ReadonlyArray<Postcondition>;
  readonly success_rate: number;
  readonly invocations: number;
  readonly last_used_at: string | null;
  readonly composed_from_skills: ReadonlyArray<string>;
  readonly status: SkillStatus;
  readonly audit_hash: string;
  readonly decayed_at: string | null;
  readonly created_at: string;
}

// ---------------------------------------------------------------------------
// Pending threads — anti-amnesia checkpoint
// ---------------------------------------------------------------------------

export interface PendingThread {
  readonly id: string;
  readonly tenant_id: string;
  readonly user_id: string;
  readonly thread_id: string;
  readonly pending_kind: PendingKind;
  readonly payload: Record<string, unknown>;
  readonly created_at: string;
  readonly resolved_at: string | null;
  readonly audit_hash: string;
}

// ---------------------------------------------------------------------------
// Thread summaries — MemGPT-style turn-block compaction
// ---------------------------------------------------------------------------

export interface ThreadSummary {
  readonly id: string;
  readonly tenant_id: string;
  readonly thread_id: string;
  readonly summary_md: string;
  readonly summarised_turn_range: readonly [number, number];
  readonly token_count_original: number | null;
  readonly token_count_summary: number | null;
  readonly generated_at: string;
  readonly audit_hash: string;
}

// ---------------------------------------------------------------------------
// Operation contexts
// ---------------------------------------------------------------------------

export interface MemoryWriteContext {
  readonly tenant_id: string;
  readonly user_id: string;
  readonly session_id: string;
  readonly thread_id: string;
  readonly now: () => Date;
}

// ---------------------------------------------------------------------------
// Ports — host-wired persistence
// ---------------------------------------------------------------------------

export interface SessionMemoryRepository {
  readonly upsert: (m: SessionMemory) => Promise<void>;
  readonly findByThread: (
    tenant_id: string,
    thread_id: string,
  ) => Promise<SessionMemory | null>;
  readonly purgeExpired: (now: Date) => Promise<number>;
}

export interface SkillRepository {
  readonly insert: (s: Skill) => Promise<void>;
  readonly findByIntent: (
    tenant_id: string,
    intent: string,
  ) => Promise<ReadonlyArray<Skill>>;
  readonly findById: (
    id: string,
    version: number,
  ) => Promise<Skill | null>;
  readonly listForDecayScan: (
    tenant_id: string,
    older_than: Date,
  ) => Promise<ReadonlyArray<Skill>>;
}

export interface PendingThreadRepository {
  readonly insert: (p: PendingThread) => Promise<void>;
  readonly resolve: (id: string, resolved_at: Date) => Promise<void>;
  readonly listUnresolved: (
    tenant_id: string,
    user_id: string,
  ) => Promise<ReadonlyArray<PendingThread>>;
}

export interface ThreadSummaryRepository {
  readonly insert: (s: ThreadSummary) => Promise<void>;
  readonly latest: (
    tenant_id: string,
    thread_id: string,
  ) => Promise<ThreadSummary | null>;
}

export interface AuditChainPort {
  readonly append: (payload: {
    readonly tenant_id: string;
    readonly event_kind:
      | 'session.upsert'
      | 'skill.observe'
      | 'skill.promote'
      | 'skill.decay'
      | 'pending.insert'
      | 'pending.resolve'
      | 'summary.generate';
    readonly entity_id: string;
    readonly recorded_at: string;
    readonly payload_digest: string;
  }) => Promise<string>;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class PersistentMemoryError extends Error {
  public override readonly name = 'PersistentMemoryError';

  constructor(
    message: string,
    public readonly code:
      | 'INVALID_INPUT'
      | 'MISSING_TENANT'
      | 'BUDGET_EXCEEDED'
      | 'AUDIT_CHAIN_FAILURE',
  ) {
    super(message);
  }
}

// ---------------------------------------------------------------------------
// Zod schemas — for callers validating untyped wire data
// ---------------------------------------------------------------------------

export const skillStatusSchema = z.enum(SKILL_STATUSES);
export const pendingKindSchema = z.enum(PENDING_KINDS);

export const skillStepSchema = z.object({
  seq: z.number().int().nonnegative(),
  tool_or_skill: z.string().min(1),
  input_template: z.record(z.unknown()),
  expected_output_schema: z.unknown(),
  retry_policy: z.object({
    max_attempts: z.number().int().min(1),
    backoff_ms: z.number().int().min(0),
    on_failure: z.enum(['abort', 'continue', 'fallback_skill']),
    fallback_skill_id: z.string().optional(),
  }),
});

export const skillSchema = z.object({
  id: z.string().min(1),
  version: z.number().int().min(1),
  tenant_id: z.string().min(1),
  scope_id: z.string().min(1),
  intent: z.string().min(1),
  preconditions: z.array(z.object({
    kind: z.enum(['has_capability', 'has_data', 'has_approval', 'has_skill']),
    identifier: z.string(),
  })),
  steps: z.array(skillStepSchema),
  postconditions: z.array(z.object({
    kind: z.enum(['wrote_artifact', 'recorded_mutation', 'sent_message']),
    identifier: z.string(),
  })),
  success_rate: z.number().min(0).max(1),
  invocations: z.number().int().nonnegative(),
  last_used_at: z.string().nullable(),
  composed_from_skills: z.array(z.string()),
  status: skillStatusSchema,
  audit_hash: z.string(),
  decayed_at: z.string().nullable(),
  created_at: z.string(),
});

export const pendingThreadInsertSchema = z.object({
  tenant_id: z.string().min(1),
  user_id: z.string().min(1),
  thread_id: z.string().min(1),
  pending_kind: pendingKindSchema,
  payload: z.record(z.unknown()),
});

export const sessionMemoryUpsertSchema = z.object({
  tenant_id: z.string().min(1),
  session_id: z.string().min(1),
  user_id: z.string().min(1),
  thread_id: z.string().min(1),
  summary_md: z.string(),
  active_decisions: z.array(z.unknown()),
  pending_questions: z.array(z.unknown()),
});
