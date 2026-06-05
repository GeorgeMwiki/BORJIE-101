/**
 * Learning-loop kernel port — LP-05 / LP-17.
 *
 * Turns the orchestrator's per-turn `learning` stage event into a real call
 * into the epistemic learning spine:
 *
 *   stage-event-bus `learning` event
 *     → map (action, outcome) from the coarse turn signal
 *       → emitSignal({ action, outcome, sinks })            (@borjie/learning-signal-emitter)
 *         ├─ reflexion sink → ReflectiveStore.upsertNote     (@borjie/memory-port-extensions → memory-v2)
 *         └─ belief   sink → reviseBelief → convince-loop     (@borjie/belief-engine; 0.25 gate)
 *
 * Before this wiring, `@borjie/learning-signal-emitter` (`emitSignal`) and
 * `@borjie/belief-engine` (`reviseBelief`) were built + unit-tested but NEVER
 * invoked at runtime — orphaned. This module is the live call path.
 *
 * Dependency discipline (mirrors the LP-03 semantic-cache-port + LP-04
 * intent-verification ports): the kernel declares NARROW structural ports for
 * the three injected functions instead of taking a hard workspace dependency.
 * The api-gateway composition root — which already imports these packages —
 * binds the real `emitSignal`, `reviseBelief`, and `createReflectiveSignalSink`
 * to these ports; their concrete types satisfy the shapes declared here, so the
 * loop calls the genuine reward-model + convince-loop, not a re-implementation.
 *
 * Belief-write rule (CLAUDE.md): the loop NEVER writes a belief directly. The
 * belief sink calls `reviseBelief`, which is the sole authorised writer; the
 * 0.25 confidence-delta gate inside the convince-loop decides every write.
 *
 * Fail-safe contract (NEVER throws into the turn hot path):
 *   - flag off / no emitter wired  → the subscriber is a no-op.
 *   - `emitSignal` (or any sink) throws → caught, logged via the Pino-style
 *     logger, the turn proceeds. The stage-event bus ALSO isolates a throwing
 *     subscriber, so this is defence in depth.
 *
 * In-memory defaults: `createInMemoryBeliefStorePort` +
 * `createInMemoryReflectiveStorePort` let the loop run end-to-end with no
 * Drizzle adapters wired. Production swaps the store ports for the Supabase
 * adapters (brain_beliefs / belief_revisions / belief_review_queue — migration
 * 0274; reflective notes — memory-v2) without touching this file.
 *
 * @module @borjie/central-intelligence/kernel/learning-loop-port
 */

import type {
  StageEvent,
  StageEventSubscriber,
} from './orchestrator/stage-event-bus.js';

// ─────────────────────────────────────────────────────────────────────
// Narrow structural ports — satisfied by the real package types.
//
// These intentionally mirror (a subset of) the public types of
// `@borjie/learning-signal-emitter`, `@borjie/belief-engine`, and
// `@borjie/memory-port-extensions`. The composition root passes the real
// objects; structural typing makes them assignable with zero adapters.
// ─────────────────────────────────────────────────────────────────────

/** Subset of learning-signal-emitter `ActionKind`. */
export type LearningActionKind =
  | 'decide'
  | 'approve'
  | 'reject'
  | 'schedule'
  | 'dispatch'
  | 'chat'
  | 'nudge'
  | 'report'
  | 'appraisal'
  | 'other';

/** Subset of learning-signal-emitter `ActionEvent`. */
export interface ActionEventLike {
  readonly id: string;
  readonly kind: LearningActionKind;
  readonly capturedAt: string;
  readonly tenantOrgId?: string | null;
  readonly tenantUserId?: string | null;
  readonly actorId: string;
  readonly actorTier: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly decisionTraceId?: string | null;
}

/** Subset of learning-signal-emitter `OutcomeEvent`. */
export interface OutcomeEventLike {
  readonly id: string;
  readonly actionRef: string;
  readonly observedAt: string;
  readonly slaHit?: boolean;
  readonly slaDelaySeconds?: number;
  readonly managerOverride?: boolean;
  readonly ownerComplaint?: boolean;
  readonly regulatorFinding?: boolean;
  readonly costTzs?: number;
  readonly budgetTzs?: number;
  readonly explicitSatisfaction?: number;
}

/**
 * Subset of learning-signal-emitter `LearningSignal` — the unit a sink
 * receives. Matches the `SignalLike` shape consumed by the reflexion sink in
 * `@borjie/memory-port-extensions`, so a sink built there can be wired here.
 */
export interface LearningSignalLike {
  readonly signalHash: string;
  readonly actionRef: string;
  readonly actionKind: string;
  readonly outcomeRef?: string;
  readonly reward: number;
  readonly components: {
    readonly sla: number;
    readonly override: number;
    readonly complaint: number;
    readonly regulator: number;
    readonly cost: number;
    readonly satisfaction: number;
  };
  readonly tenantScope: 'user' | 'org' | 'platform';
  readonly subjectUserId?: string | null;
  readonly subjectOrgId?: string | null;
  readonly emittedBy: string;
  readonly decisionTraceId?: string | null;
  readonly capturedAt: string;
}

/**
 * Subset of learning-signal-emitter `SignalSinks`. Each adapter returns `true`
 * when it accepted the signal; `undefined`/absent means "not configured".
 */
export interface SignalSinksLike {
  readonly beliefStrengthen?: (s: LearningSignalLike) => Promise<boolean>;
  readonly reflexionRecord?: (s: LearningSignalLike) => Promise<boolean>;
  readonly masteryUpdate?: (s: LearningSignalLike) => Promise<boolean>;
  readonly patternStore?: (s: LearningSignalLike) => Promise<boolean>;
  readonly personaPrompt?: (s: LearningSignalLike) => Promise<boolean>;
  readonly preferenceLearner?: (s: LearningSignalLike) => Promise<boolean>;
}

/** Subset of learning-signal-emitter `EmissionResult`. */
export interface EmissionResultLike {
  readonly signal: LearningSignalLike;
  readonly routedTo: ReadonlyArray<string>;
  readonly notes: ReadonlyArray<string>;
}

/** Subset of learning-signal-emitter `EmitInput`. */
export interface EmitInputLike {
  readonly action: ActionEventLike;
  readonly outcome: OutcomeEventLike;
  readonly sinks?: SignalSinksLike;
}

/**
 * Port for `@borjie/learning-signal-emitter` `emitSignal`. The composition
 * root binds the real function; it never throws (the emitter absorbs sink
 * failures into `notes`), but we still wrap it for defence in depth.
 */
export type EmitSignalFn = (input: EmitInputLike) => Promise<EmissionResultLike>;

// ── Belief-engine ports ────────────────────────────────────────────────

/** Subset of belief-engine `BeliefValue`. */
export interface BeliefValueLike {
  readonly kind: 'scalar' | 'range' | 'categorical' | 'boolean' | 'text';
  readonly scalar?: number;
  readonly rangeMin?: number;
  readonly rangeMax?: number;
  readonly unit?: string;
  readonly categorical?: string;
  readonly boolean?: boolean;
  readonly text?: string;
}

/** Subset of belief-engine `ExtractedClaim`. */
export interface ExtractedClaimLike {
  readonly subject: string;
  readonly description: string;
  readonly proposedValue: BeliefValueLike;
  readonly evidenceFromTurn: string;
  readonly confidence: number;
  readonly conversationId: string;
  readonly turnId: string;
  readonly portal: 'worker' | 'manager' | 'admin' | 'owner';
  readonly domain:
    | 'regulatory'
    | 'sector-economics'
    | 'regional-economics'
    | 'market-prices'
    | 'estate-pattern'
    | 'process'
    | 'general';
  readonly subjectUserId?: string | null;
  readonly subjectOrgId?: string | null;
  readonly quarantined?: boolean;
}

/** Subset of belief-engine `ConvinceResult`. */
export interface ConvinceResultLike {
  readonly action: 'no-change' | 'strengthen' | 'revise' | 'split';
  readonly confidenceDelta: number;
  readonly rationale: string;
}

/**
 * Port for `@borjie/belief-engine` `reviseBelief`. The SOLE authorised belief
 * writer — the loop calls only this, never a store `upsert`. The `deps`
 * payload is the engine's `ReviseBeliefDeps` (store + optional webSearch /
 * now / idFactory); the kernel treats it as opaque and forwards it.
 */
export type ReviseBeliefFn = (
  claim: ExtractedClaimLike,
  deps: unknown,
) => Promise<ConvinceResultLike>;

// ── Reflexion-store port ────────────────────────────────────────────────

/** Subset of memory-port-extensions `ReflectiveNoteLike`. */
export interface ReflectiveNoteLike {
  readonly id: string;
  readonly tenantId: string;
  readonly userId: string | null;
  readonly insight: string;
  readonly adjustments: ReadonlyArray<string>;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly selfScore: number;
  readonly createdAt: string;
}

/** Subset of memory-port-extensions `ReflectiveStoreLike` (write path). */
export interface ReflectiveStorePort {
  upsertNote(note: ReflectiveNoteLike): Promise<ReflectiveNoteLike>;
}

// ── Belief-store port (for the in-memory default) ───────────────────────

/**
 * Minimal belief-store surface the in-memory default implements. Matches
 * belief-engine `BeliefStorePort` structurally so `reviseBelief` can take it
 * verbatim. Kept narrow on purpose — the kernel never calls it directly.
 */
export interface BeliefStorePort {
  findBySubject(subject: string, scope?: unknown): Promise<unknown | null>;
  listByDomain(
    domain: string,
    limit?: number,
    scope?: unknown,
  ): Promise<ReadonlyArray<unknown>>;
  upsert(belief: unknown): Promise<unknown>;
  recordRevision(record: unknown): Promise<void>;
  enqueueReview(item: unknown): Promise<void>;
}

// ─────────────────────────────────────────────────────────────────────
// Logger port (Pino-shaped — no console.log in this package).
// ─────────────────────────────────────────────────────────────────────

export interface LearningLoopLogger {
  warn(msg: string, meta?: Record<string, unknown>): void;
  debug?(msg: string, meta?: Record<string, unknown>): void;
}

// ─────────────────────────────────────────────────────────────────────
// PURE — map a coarse turn `learning` signal into (action, outcome).
// ─────────────────────────────────────────────────────────────────────

export interface TurnLearningFacts {
  readonly turnId: string;
  readonly threadId: string;
  readonly tenantId: string | null;
  /** Coarse outcome label from the orchestrator's `learning` stage event. */
  readonly signal: 'success' | 'partial' | 'failure';
  /** Epoch ms the event fired (the stage event's `at`). */
  readonly atMs: number;
  /** Best-available actor id (the orchestrator persona). */
  readonly actorId: string;
  readonly actorTier: string;
  /** Action kind for the turn. Chat turns default to `chat`. */
  readonly actionKind?: LearningActionKind;
}

/**
 * Build the (action, outcome) pair from a turn's learning facts. PURE.
 *
 * The orchestrator seam yields a coarse `success | partial | failure` label,
 * not a measured SLA / complaint. We translate it into an explicit
 * satisfaction signal so the reward model produces a bounded, sign-correct
 * reward (+1 success, 0 partial, -1 failure) without inventing SLA or cost
 * numbers the turn never measured. Richer outcomes (a later manager override,
 * an owner complaint) arrive through their own emit call sites, not here.
 */
export function mapLearningSignalToEvents(facts: TurnLearningFacts): {
  readonly action: ActionEventLike;
  readonly outcome: OutcomeEventLike;
} {
  const iso = new Date(facts.atMs).toISOString();
  const orgId = facts.tenantId;
  const actionId = `turn:${facts.turnId}:${facts.atMs}`;
  const satisfaction =
    facts.signal === 'success' ? 1 : facts.signal === 'failure' ? -1 : 0;

  const action: ActionEventLike = Object.freeze({
    id: actionId,
    kind: facts.actionKind ?? 'chat',
    capturedAt: iso,
    tenantOrgId: orgId,
    tenantUserId: null,
    actorId: facts.actorId,
    actorTier: facts.actorTier,
    payload: Object.freeze({ threadId: facts.threadId, signal: facts.signal }),
    decisionTraceId: facts.turnId,
  });

  const outcome: OutcomeEventLike = Object.freeze({
    id: `outcome:${actionId}`,
    actionRef: actionId,
    observedAt: iso,
    explicitSatisfaction: satisfaction,
  });

  return Object.freeze({ action, outcome });
}

// ─────────────────────────────────────────────────────────────────────
// Belief sink — wraps `reviseBelief`. NEVER writes a belief directly.
// ─────────────────────────────────────────────────────────────────────

export interface BeliefSinkDeps {
  readonly reviseBelief: ReviseBeliefFn;
  /** Opaque belief-engine `ReviseBeliefDeps` (store + optional now/idFactory). */
  readonly reviseBeliefDeps: unknown;
  /**
   * Maps an accepted learning signal into a belief claim. Returns `null` when
   * the signal carries no claim worth revising a belief over (the common case
   * for a generic chat turn — only domain claims should move a belief).
   * Defaults to `null` so the belief sink is inert until a composition root
   * supplies a real claim extractor.
   */
  readonly claimFromSignal?: (
    signal: LearningSignalLike,
  ) => ExtractedClaimLike | null;
}

/**
 * Build the emitter's `beliefStrengthen` adapter. Routes EXCLUSIVELY through
 * `reviseBelief` (the 0.25-gated convince-loop). Returns `true` when a belief
 * write was attempted (any convince action), `false` when there was no claim
 * or the call failed. NEVER throws — the emitter folds a thrown error into its
 * own notes, and we add a swallow here for defence in depth.
 */
export function buildBeliefSink(
  deps: BeliefSinkDeps,
): (signal: LearningSignalLike) => Promise<boolean> {
  const extract = deps.claimFromSignal ?? (() => null);
  return async (signal: LearningSignalLike): Promise<boolean> => {
    try {
      const claim = extract(signal);
      if (claim === null) return false;
      await deps.reviseBelief(claim, deps.reviseBeliefDeps);
      return true;
    } catch {
      return false;
    }
  };
}

// ─────────────────────────────────────────────────────────────────────
// In-memory defaults — let the loop run end-to-end with no DB adapters.
// ─────────────────────────────────────────────────────────────────────

/**
 * In-memory belief store implementing the narrow `BeliefStorePort`. Suitable
 * for local dev + tests. Production binds the Supabase adapter instead. The
 * map is keyed by `(subject|user|org)` so tenant scopes never collide.
 */
export function createInMemoryBeliefStorePort(): BeliefStorePort & {
  /** Test introspection — current live beliefs. */
  snapshot(): ReadonlyArray<unknown>;
} {
  const beliefs = new Map<string, { id: string; [k: string]: unknown }>();
  const revisions: unknown[] = [];
  const reviews: unknown[] = [];
  let counter = 0;

  const keyOf = (b: Record<string, unknown>): string =>
    `${String(b.subject ?? '')}|${String(b.subjectUserId ?? '')}|${String(
      b.subjectOrgId ?? '',
    )}`;

  return {
    async findBySubject(subject, scope) {
      const s = (scope ?? {}) as Record<string, unknown>;
      const key = `${subject}|${String(s.subjectUserId ?? '')}|${String(
        s.subjectOrgId ?? '',
      )}`;
      return beliefs.get(key) ?? null;
    },
    async listByDomain(domain, limit = 100) {
      return Array.from(beliefs.values())
        .filter((b) => b.domain === domain)
        .slice(0, limit);
    },
    async upsert(belief) {
      const b = { ...(belief as Record<string, unknown>) };
      const id = (b.id as string) || `belief-${(counter += 1)}`;
      const persisted = { ...b, id } as { id: string; [k: string]: unknown };
      beliefs.set(keyOf(persisted), persisted);
      return persisted;
    },
    async recordRevision(record) {
      revisions.push(record);
    },
    async enqueueReview(item) {
      reviews.push(item);
    },
    snapshot() {
      return Array.from(beliefs.values());
    },
  };
}

/**
 * In-memory reflective store implementing `ReflectiveStorePort`. Production
 * binds the memory-v2 reflective adapter. The notes array is append-only.
 */
export function createInMemoryReflectiveStorePort(): ReflectiveStorePort & {
  /** Test introspection — all upserted notes. */
  snapshot(): ReadonlyArray<ReflectiveNoteLike>;
} {
  const notes: ReflectiveNoteLike[] = [];
  return {
    async upsertNote(note) {
      const next = notes.filter((n) => n.id !== note.id);
      next.push(note);
      notes.length = 0;
      notes.push(...next);
      return note;
    },
    snapshot() {
      return [...notes];
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// The subscriber — the live call path.
// ─────────────────────────────────────────────────────────────────────

export interface LearningLoopDeps {
  /**
   * Master flag. Resolved at bootstrap from `BORJIE_LEARNING_LOOP_ENABLED`
   * (default ON) — the kernel never reads `process.env` itself. When `false`
   * the subscriber is a no-op.
   */
  readonly enabled: boolean;
  /**
   * The real `@borjie/learning-signal-emitter` `emitSignal`, bound by the
   * composition root. When omitted the subscriber is inert (logged once via
   * `logger.debug`) — so the loop is safe even before stores are injected.
   */
  readonly emitSignal?: EmitSignalFn;
  /** Reflexion sink — `createReflectiveSignalSink(...)` from memory-port-extensions. */
  readonly reflexionRecord?: (s: LearningSignalLike) => Promise<boolean>;
  /** Belief sink — `buildBeliefSink({ reviseBelief, ... })`. */
  readonly beliefStrengthen?: (s: LearningSignalLike) => Promise<boolean>;
  /** Actor id stamped on the synthetic action (the orchestrator persona). */
  readonly actorId?: string;
  readonly actorTier?: string;
  readonly logger?: LearningLoopLogger;
}

/**
 * Create the stage-event-bus subscriber that runs the learning loop on each
 * turn's `learning` event. Register the returned function on the bus the
 * orchestrator already emits to:
 *
 *   const bus = createStageEventBus({ logger });
 *   bus.subscribe(createLearningLoopSubscriber({
 *     enabled: learningLoopEnabled,            // from BORJIE_LEARNING_LOOP_ENABLED
 *     emitSignal,                              // @borjie/learning-signal-emitter
 *     reflexionRecord: createReflectiveSignalSink({ store, idFactory }),
 *     beliefStrengthen: buildBeliefSink({ reviseBelief, reviseBeliefDeps }),
 *     actorId: persona.id, actorTier: tier, logger,
 *   }));
 *   // ...then pass `{ stageBus: bus }` in OrchestratorDeps.
 *
 * Only the `learning` stage triggers emission; all other stages are ignored.
 * The whole body is wrapped so a fault NEVER propagates into the turn.
 */
export function createLearningLoopSubscriber(
  deps: LearningLoopDeps,
): StageEventSubscriber {
  let warnedInert = false;
  return async (event: StageEvent): Promise<void> => {
    if (event.stage !== 'learning') return;
    if (!deps.enabled) return;
    if (deps.emitSignal === undefined) {
      if (!warnedInert) {
        warnedInert = true;
        deps.logger?.debug?.(
          'learning-loop: enabled but no emitSignal wired — inert',
          { turnId: event.turnId },
        );
      }
      return;
    }
    try {
      const { action, outcome } = mapLearningSignalToEvents({
        turnId: event.turnId,
        threadId: event.threadId,
        tenantId: event.tenantId,
        signal: event.signal,
        atMs: event.at,
        actorId: deps.actorId ?? 'mr-mwikila',
        actorTier: deps.actorTier ?? 'platform',
      });
      const sinks: SignalSinksLike = {
        ...(deps.beliefStrengthen
          ? { beliefStrengthen: deps.beliefStrengthen }
          : {}),
        ...(deps.reflexionRecord
          ? { reflexionRecord: deps.reflexionRecord }
          : {}),
      };
      const result = await deps.emitSignal({ action, outcome, sinks });
      deps.logger?.debug?.('learning-loop: signal emitted', {
        turnId: event.turnId,
        reward: result.signal.reward,
        routedTo: result.routedTo.join(','),
        notes: result.notes.length,
      });
    } catch (err) {
      // Fail-safe: a learning-loop fault must never break the served turn.
      deps.logger?.warn('learning-loop: emission failed (isolated)', {
        turnId: event.turnId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };
}
