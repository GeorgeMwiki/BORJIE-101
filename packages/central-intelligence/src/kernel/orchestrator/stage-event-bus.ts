/**
 * Stage-event bus — LP-07.
 *
 * A typed, ordered event bus over the orchestrator main-loop, mirroring
 * LITFIN's `runTurn` stage taxonomy (`src/core/brain/agentic-pipeline.ts`):
 *
 *   intent → megaprompt → plan → step (×N) → outcome → learning
 *
 * Purpose: ONE seam where OTel spans, the learning signal-emitter, and ops
 * telemetry can observe the turn lifecycle, instead of scraping logs. The
 * orchestrator emits each event at the natural point in `thinkExtended`;
 * subscribers (an OTel sink, a learning sink) receive a frozen, typed event.
 *
 * Design rules:
 *   - The bus NEVER throws into the hot path. A subscriber error is caught,
 *     logged via the optional logger, and the loop proceeds.
 *   - Events are immutable (frozen) and carry a monotonic `seq` + `turnId`
 *     so a consumer can reassemble per-turn ordering across interleaved
 *     concurrent turns.
 *   - Emission is synchronous fire-and-forget from the loop's perspective:
 *     `emit` awaits subscribers so an OTel span closes in order, but each
 *     subscriber is individually time-bounded by the caller's own sink (the
 *     bus itself does not impose a timeout — keep sinks fast).
 *   - Zero heavy deps. Pure TypeScript.
 *
 * This is a SOUND INCREMENT: the bus + the emission points are in place and
 * tested; richer per-stage payloads can be layered without an API break
 * because every event carries an open `attributes` bag.
 *
 * @module @borjie/central-intelligence/kernel/orchestrator/stage-event-bus
 */

// ---------------------------------------------------------------------------
// Stage taxonomy
// ---------------------------------------------------------------------------

export const STAGE_NAMES = [
  'intent',
  'megaprompt',
  'plan',
  'step',
  'outcome',
  'learning',
] as const;

export type StageName = (typeof STAGE_NAMES)[number];

/** Canonical emission order. A turn emits `intent` once, `megaprompt` once,
 *  `plan` once, `step` zero-or-more times, then `outcome` once, then
 *  optionally `learning` once. Exported so the OTel sink can validate. */
export const STAGE_ORDER: Readonly<Record<StageName, number>> = Object.freeze({
  intent: 0,
  megaprompt: 1,
  plan: 2,
  step: 3,
  outcome: 4,
  learning: 5,
});

// ---------------------------------------------------------------------------
// Event shapes (discriminated union on `stage`)
// ---------------------------------------------------------------------------

interface StageEventBase {
  /** Monotonic sequence within the emitting bus (across all turns). */
  readonly seq: number;
  readonly turnId: string;
  readonly threadId: string;
  readonly tenantId: string | null;
  /** Epoch ms when the event was emitted. */
  readonly at: number;
  /** Open attribute bag for OTel span attributes / future payloads. */
  readonly attributes: Readonly<Record<string, string | number | boolean>>;
}

export interface IntentStageEvent extends StageEventBase {
  readonly stage: 'intent';
  /** Length of the user message (avoids logging raw PII by default). */
  readonly userMessageLength: number;
}

export interface MegapromptStageEvent extends StageEventBase {
  readonly stage: 'megaprompt';
  /** Assembled system-prompt size in bytes (prompt-cache telemetry). */
  readonly systemPromptBytes: number;
}

export interface PlanStageEvent extends StageEventBase {
  readonly stage: 'plan';
  readonly goalCount: number;
}

export interface StepStageEvent extends StageEventBase {
  readonly stage: 'step';
  /** 1-based step index within the turn. */
  readonly stepIndex: number;
  readonly toolName: string;
  readonly outcomeKind: string;
}

export interface OutcomeStageEvent extends StageEventBase {
  readonly stage: 'outcome';
  /** The orchestrator response kind (answer / stopped / ack-defer …). */
  readonly responseKind: string;
  readonly stepsTaken: number;
}

export interface LearningStageEvent extends StageEventBase {
  readonly stage: 'learning';
  /** A coarse outcome label the learning loop can reward on. */
  readonly signal: 'success' | 'partial' | 'failure';
}

export type StageEvent =
  | IntentStageEvent
  | MegapromptStageEvent
  | PlanStageEvent
  | StepStageEvent
  | OutcomeStageEvent
  | LearningStageEvent;

// ---------------------------------------------------------------------------
// Bus
// ---------------------------------------------------------------------------

export interface StageEventSubscriber {
  (event: StageEvent): void | Promise<void>;
}

export interface StageEventBusLogger {
  warn(msg: string, meta?: Record<string, unknown>): void;
}

export interface StageEventBus {
  /** Register a subscriber. Returns an unsubscribe function. */
  subscribe(subscriber: StageEventSubscriber): () => void;
  /** Emit an event to all subscribers. NEVER throws. */
  emit(event: StageEvent): Promise<void>;
  /** Current monotonic sequence (number of events emitted). */
  readonly emittedCount: () => number;
}

export interface CreateStageEventBusDeps {
  readonly logger?: StageEventBusLogger;
  readonly clock?: () => number;
}

/**
 * Create an in-memory stage-event bus. Subscribers are invoked in
 * registration order; a throwing subscriber is isolated (logged, skipped)
 * so one bad sink cannot break the turn or starve other sinks.
 */
export function createStageEventBus(
  deps: CreateStageEventBusDeps = {},
): StageEventBus {
  const subscribers = new Set<StageEventSubscriber>();
  let emitted = 0;

  async function emit(event: StageEvent): Promise<void> {
    emitted += 1;
    for (const subscriber of subscribers) {
      try {
        await subscriber(event);
      } catch (err) {
        deps.logger?.warn('stage-event-bus: subscriber threw (isolated)', {
          stage: event.stage,
          turnId: event.turnId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  return Object.freeze({
    subscribe(subscriber: StageEventSubscriber): () => void {
      subscribers.add(subscriber);
      return () => {
        subscribers.delete(subscriber);
      };
    },
    emit,
    // Total events dispatched across all turns. Per-turn ordering lives on
    // each event's `seq` (assigned by the turn emitter below).
    emittedCount: () => emitted,
  });
}

// ---------------------------------------------------------------------------
// Emit helpers — assign `seq` + `at` and build frozen events. The
// orchestrator calls these so the call sites stay terse and every event is
// well-formed. Each is fail-safe (delegates to the bus's isolated emit).
// ---------------------------------------------------------------------------

export interface StageEmitterContext {
  readonly bus: StageEventBus | undefined;
  readonly turnId: string;
  readonly threadId: string;
  readonly tenantId: string | null;
  readonly clock: () => number;
}

/**
 * Build a per-turn emitter bound to a turn context. Holds its own sequence
 * counter so events for ONE turn are strictly ordered even if the shared
 * bus interleaves turns. When `bus` is undefined every method is a no-op.
 */
export function createTurnStageEmitter(ctx: StageEmitterContext): {
  readonly intent: (userMessageLength: number, attributes?: Attrs) => Promise<void>;
  readonly megaprompt: (systemPromptBytes: number, attributes?: Attrs) => Promise<void>;
  readonly plan: (goalCount: number, attributes?: Attrs) => Promise<void>;
  readonly step: (
    stepIndex: number,
    toolName: string,
    outcomeKind: string,
    attributes?: Attrs,
  ) => Promise<void>;
  readonly outcome: (
    responseKind: string,
    stepsTaken: number,
    attributes?: Attrs,
  ) => Promise<void>;
  readonly learning: (
    signal: LearningStageEvent['signal'],
    attributes?: Attrs,
  ) => Promise<void>;
} {
  let localSeq = 0;
  const base = (): Omit<StageEventBase, 'stage' | 'attributes'> => ({
    seq: localSeq++,
    turnId: ctx.turnId,
    threadId: ctx.threadId,
    tenantId: ctx.tenantId,
    at: ctx.clock(),
  });
  const freezeAttrs = (a?: Attrs): StageEventBase['attributes'] =>
    Object.freeze({ ...(a ?? {}) });

  const send = async (event: StageEvent): Promise<void> => {
    if (ctx.bus === undefined) return;
    await ctx.bus.emit(event);
  };

  return Object.freeze({
    async intent(userMessageLength, attributes) {
      await send(
        Object.freeze({
          stage: 'intent',
          ...base(),
          userMessageLength,
          attributes: freezeAttrs(attributes),
        }),
      );
    },
    async megaprompt(systemPromptBytes, attributes) {
      await send(
        Object.freeze({
          stage: 'megaprompt',
          ...base(),
          systemPromptBytes,
          attributes: freezeAttrs(attributes),
        }),
      );
    },
    async plan(goalCount, attributes) {
      await send(
        Object.freeze({
          stage: 'plan',
          ...base(),
          goalCount,
          attributes: freezeAttrs(attributes),
        }),
      );
    },
    async step(stepIndex, toolName, outcomeKind, attributes) {
      await send(
        Object.freeze({
          stage: 'step',
          ...base(),
          stepIndex,
          toolName,
          outcomeKind,
          attributes: freezeAttrs(attributes),
        }),
      );
    },
    async outcome(responseKind, stepsTaken, attributes) {
      await send(
        Object.freeze({
          stage: 'outcome',
          ...base(),
          responseKind,
          stepsTaken,
          attributes: freezeAttrs(attributes),
        }),
      );
    },
    async learning(signal, attributes) {
      await send(
        Object.freeze({
          stage: 'learning',
          ...base(),
          signal,
          attributes: freezeAttrs(attributes),
        }),
      );
    },
  });
}

type Attrs = Readonly<Record<string, string | number | boolean>>;
