/**
 * Funnel intelligence + demo-storage primitives.
 *
 * Ported from LITFIN's funnel-intelligence shape (which tracked
 * borrower acquisition: visitor -> signup -> KYC -> first-application
 * -> funded). For Borjie the funnel is owner / buyer / worker
 * acquisition:
 *
 *   visitor -> demo-signup -> persona-complete -> first-chat-turn ->
 *     first-decision -> first-shift / first-buy / first-payout
 *
 * Plus a separate demo-storage primitive for the ephemeral data we
 * keep against the visitor-id between landing and signup, so the
 * brain can resume from "where they were" once they convert.
 */

export type FunnelStage =
  | "visitor"
  | "demo_signup"
  | "persona_complete"
  | "first_chat_turn"
  | "first_decision"
  | "first_outcome";

export interface FunnelEvent {
  readonly visitorId: string;
  readonly stage: FunnelStage;
  readonly occurredAt: string;
  readonly meta?: Record<string, string | number | boolean>;
}

export interface FunnelSnapshot {
  readonly tenantId: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly counts: Readonly<Record<FunnelStage, number>>;
  readonly conversion: Readonly<{
    readonly visitorToSignup: number;
    readonly signupToPersona: number;
    readonly personaToFirstChat: number;
    readonly firstChatToFirstDecision: number;
    readonly firstDecisionToFirstOutcome: number;
  }>;
}

function rate(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  return numerator / denominator;
}

/**
 * Aggregate raw events into a stage-by-stage snapshot + conversion
 * rates. Pure function; takes an array of events, returns a NEW
 * snapshot.
 */
export function aggregateFunnel(args: {
  readonly tenantId: string;
  readonly events: ReadonlyArray<FunnelEvent>;
  readonly periodStart: string;
  readonly periodEnd: string;
}): FunnelSnapshot {
  const counts: Record<FunnelStage, number> = {
    visitor: 0,
    demo_signup: 0,
    persona_complete: 0,
    first_chat_turn: 0,
    first_decision: 0,
    first_outcome: 0,
  };
  // Per-visitor highest stage reached.
  const highestByVisitor = new Map<string, FunnelStage>();
  const stageOrder: Record<FunnelStage, number> = {
    visitor: 0,
    demo_signup: 1,
    persona_complete: 2,
    first_chat_turn: 3,
    first_decision: 4,
    first_outcome: 5,
  };
  for (const ev of args.events) {
    const prev = highestByVisitor.get(ev.visitorId);
    if (!prev || stageOrder[ev.stage] > stageOrder[prev]) {
      highestByVisitor.set(ev.visitorId, ev.stage);
    }
  }
  for (const stage of highestByVisitor.values()) {
    // Inclusive accumulation: a visitor at first_chat_turn also counts
    // for visitor / demo_signup / persona_complete.
    for (const candidate of Object.keys(stageOrder) as FunnelStage[]) {
      if (stageOrder[stage] >= stageOrder[candidate]) {
        counts[candidate] += 1;
      }
    }
  }
  return Object.freeze({
    tenantId: args.tenantId,
    periodStart: args.periodStart,
    periodEnd: args.periodEnd,
    counts: Object.freeze(counts),
    conversion: Object.freeze({
      visitorToSignup: rate(counts.demo_signup, counts.visitor),
      signupToPersona: rate(counts.persona_complete, counts.demo_signup),
      personaToFirstChat: rate(counts.first_chat_turn, counts.persona_complete),
      firstChatToFirstDecision: rate(
        counts.first_decision,
        counts.first_chat_turn,
      ),
      firstDecisionToFirstOutcome: rate(
        counts.first_outcome,
        counts.first_decision,
      ),
    }),
  });
}

/**
 * Demo-storage primitive: small key-value store keyed by visitorId,
 * caller-supplied backend (memory map, Redis, Supabase row). The shape
 * is the contract; backends slot in via the interface.
 *
 * The brain consumes whatever is stored here as soft prior on the
 * caller's intent once they convert from visitor to signed-up user.
 */
export interface DemoStorageBackend {
  get(visitorId: string): Promise<Record<string, unknown> | null>;
  put(visitorId: string, value: Record<string, unknown>): Promise<void>;
  drop(visitorId: string): Promise<void>;
}

export function createInMemoryDemoStorage(): DemoStorageBackend {
  const store = new Map<string, Record<string, unknown>>();
  return {
    async get(visitorId) {
      return store.get(visitorId) ?? null;
    },
    async put(visitorId, value) {
      store.set(visitorId, { ...value });
    },
    async drop(visitorId) {
      store.delete(visitorId);
    },
  };
}
