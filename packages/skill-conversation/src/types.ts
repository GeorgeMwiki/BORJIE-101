/**
 * @borjie/skill-conversation — public types
 *
 * Substrate for owner-as-programmer-by-conversation: an owner-customer or
 * internal-admin says something in chat; we classify the intent, ask for
 * confirmation if it looks like a recurring/conditional task, compile via
 * @borjie/aop-compiler, and persist the resulting skill anchored back
 * to the conversation message it was born in.
 *
 * This module's types are wire-agnostic. Storage, LLM, and autonomy
 * enforcement are all delegated to ports.
 */

import type {
  AOP,
  CompileFailure,
  CompileSuccess,
  ValidationError,
} from '@borjie/aop-compiler';

/**
 * The four intent kinds the classifier emits.
 *
 *   - `recurring`   — "every Monday morning send me X" / "every 25th of the month do Y"
 *   - `conditional` — "if X happens then Y" / "when arrears > 30d, draft eviction"
 *   - `ad-hoc`     — "send this email now" / "show me last week's report"
 *   - `question`   — "what is my arrears total?" / "how many tenants are late?"
 *
 * `recurring` and `conditional` are the two kinds that compile to an AOP. The
 * other two go to ai-copilot's ad-hoc tool flow or the Q&A path respectively.
 */
export type IntentKind = 'recurring' | 'conditional' | 'ad-hoc' | 'question';

/**
 * The conservative confirmation gate. When the classifier is between 0.3 and
 * 0.85 confidence, it emits a `needs-confirmation` verdict with a `prompt` for
 * the owner ("I think you want me to do X. Should I set that up?"). The owner
 * must reply 'yes' / 'confirm' / 'go ahead' before the AOP compile fires.
 */
export interface IntentVerdict {
  readonly kind: IntentKind;
  readonly confidence: number;
  /** The signals that pushed us into this verdict — for transparency + audit. */
  readonly signals: ReadonlyArray<string>;
  /** When non-null, the chat surface must show this prompt before compiling. */
  readonly confirmation: ConfirmationPrompt | null;
  /**
   * If true, ai-copilot may bypass the AOP compile path entirely — the user is
   * asking a question or wanting a one-off action. We never auto-set-up a
   * skill for these.
   */
  readonly compileEligible: boolean;
}

export interface ConfirmationPrompt {
  /** Plain-English summary of what we think the owner wants. */
  readonly summary: string;
  /** What we'll do if they say yes. */
  readonly plan: string;
  /** Replies that count as approval (case-insensitive, lowercased). */
  readonly approvalKeywords: ReadonlyArray<string>;
  /** Replies that count as rejection (case-insensitive, lowercased). */
  readonly rejectionKeywords: ReadonlyArray<string>;
}

/** Scope determines whose autonomy cap + tenant context applies. */
export type SkillScope = 'owner-customer' | 'internal-admin';

/**
 * Conversation anchor — every compiled skill remembers the chat message it
 * was born in so the owner can ask "show me skills you've set up" and get a
 * list with creation context (date, original NL, which conversation).
 */
export interface ConversationAnchor {
  readonly conversationId: string;
  readonly messageId: string;
  /** ISO timestamp the skill was created. */
  readonly createdAt: string;
  /** The NL prompt that birthed the skill — for audit + replay. */
  readonly originalNL: string;
}

/**
 * The lifecycle of a skill in the registry.
 *
 *   - `draft`      — compiled but not yet confirmed by the user (rare; we
 *                    usually confirm-then-compile)
 *   - `active`     — running on the cron/event substrate
 *   - `paused`     — temporarily suspended; cron/events ignore it but state
 *                    is retained so resume re-arms
 *   - `deleted`    — soft-deleted; visible in audit but not in lists
 */
export type SkillLifecycle = 'draft' | 'active' | 'paused' | 'deleted';

export interface SkillStatusEvent {
  /** ISO timestamp of the event. */
  readonly at: string;
  /** Free-text describing what happened (run start, completion, failure, pause). */
  readonly kind:
    | 'created'
    | 'activated'
    | 'paused'
    | 'resumed'
    | 'deleted'
    | 'run-started'
    | 'run-completed'
    | 'run-failed';
  readonly note?: string | undefined;
}

/**
 * One row in the skill registry. A skill is uniquely identified by
 * `id` (UUID-ish, set by the wire-side adapter when persisting).
 */
export interface SkillRegistryEntry {
  readonly id: string;
  readonly scope: SkillScope;
  /**
   * For `owner-customer`: required tenant id. For `internal-admin`: optional
   * — when absent, the skill is platform-wide ("every Monday, send all
   * platform admins the cross-tenant churn report").
   */
  readonly tenantId: string | null;
  readonly authorActorId: string;
  readonly anchor: ConversationAnchor;
  readonly aopName: string;
  readonly aopVersion: string;
  readonly lifecycle: SkillLifecycle;
  /** Plain-English description shown in the skill list. */
  readonly summary: string;
  /** History of lifecycle events — for chat-surface storytelling. */
  readonly history: ReadonlyArray<SkillStatusEvent>;
  /**
   * A reference to where the cron is registered, if applicable. Stored as
   * an opaque string so wire-side adapters can encode whatever they need.
   */
  readonly cronHandle: string | null;
  /** Number of times this skill has run since creation. */
  readonly runCount: number;
  /** Last run's outcome — for "show me what skills you've set up" surfaces. */
  readonly lastRun:
    | {
        readonly at: string;
        readonly outcome: 'completed' | 'failed' | 'in-progress';
        readonly note?: string | undefined;
      }
    | null;
}

/**
 * Autonomy validator port. The wire-side adapter wires this to
 * @borjie/autonomy-governance's `evaluateAutonomyCap`.
 *
 * Returning `{ ok: false }` rejects the compile entirely — the owner is
 * told their cap would be exceeded.
 */
export interface AutonomyValidator {
  evaluate(args: {
    readonly scope: SkillScope;
    readonly tenantId: string | null;
    readonly ast: AOP;
  }): Promise<{ readonly ok: boolean; readonly reason?: string }>;
}

/**
 * Storage port for the skill registry.
 *
 * Wire-side: a SQL adapter against `skill_registry` + `skill_history`.
 * Tests: `InMemorySkillRegistry`.
 */
export interface SkillRegistry {
  save(entry: SkillRegistryEntry): Promise<void>;
  load(id: string): Promise<SkillRegistryEntry | null>;
  listByOwner(args: {
    readonly scope: SkillScope;
    readonly tenantId: string | null;
  }): Promise<ReadonlyArray<SkillRegistryEntry>>;
  update(
    id: string,
    patch: (entry: SkillRegistryEntry) => SkillRegistryEntry,
  ): Promise<SkillRegistryEntry | null>;
}

/**
 * The successful output of `compileSkillFromNL`. Wraps the AOP compiler's
 * success with the registry entry + chat-ready prose.
 */
export interface CompileSkillSuccess {
  readonly ok: true;
  readonly aopResult: CompileSuccess;
  readonly registryEntry: SkillRegistryEntry;
  /** What the chat surface should show the owner ("Done. First brief Monday 7am EAT…"). */
  readonly chatConfirmation: string;
}

/**
 * Failure either from intent classification, AOP compile, or autonomy check.
 * `stage` lets the chat surface tell the owner *where* it went wrong.
 */
export interface CompileSkillFailure {
  readonly ok: false;
  readonly stage:
    | 'intent-rejected'
    | 'autonomy-rejected'
    | 'aop-parse-failed'
    | 'aop-validation-failed'
    | 'destructive-blocked';
  readonly errors: ReadonlyArray<ValidationError>;
  /** Owner-facing message. Never leaks internal codes. */
  readonly chatRejection: string;
}

export type CompileSkillResult = CompileSkillSuccess | CompileSkillFailure;

export type { ValidationError, CompileSuccess, CompileFailure } from '@borjie/aop-compiler';
