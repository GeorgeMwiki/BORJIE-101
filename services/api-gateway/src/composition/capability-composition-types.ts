/**
 * Capability-Composition Engine — shared type contracts.
 *
 * The Tier-2 self-architect. When a novel need cleared the hard rails in
 * `chat-actions.hono.ts::gateExecuteAudit` (the generative `deferToBrain`
 * branch), the engine surveys the brain's own power-tool inventory, runs a
 * tree-search over COMPOSITIONS of those tools, governance-gates the winning
 * chain, and executes it transactionally via `power_tool.compose` — BEFORE
 * falling back to a plain brain turn.
 *
 * These contracts are deliberately small and dependency-light so the engine
 * is unit-testable with injected mocks (a fake model port + a fake registry),
 * needing no real Anthropic client or Postgres.
 *
 * @module composition/capability-composition-types
 */

import { powerTools, type ScopeContext } from '@borjie/central-intelligence';

type ComposeArgs = powerTools.ComposeArgs;
type ComposeOutput = powerTools.ComposeOutput;
type PowerToolContext = powerTools.PowerToolContext;

// ─────────────────────────────────────────────────────────────────────
// Model port — text-in / text-out. The engine's LATS oracles call this.
// ─────────────────────────────────────────────────────────────────────

/**
 * The single LLM capability the engine needs: take a system + user prompt
 * and return raw assistant text. This is the SAME circuit-breaker +
 * OTel-wrapped Anthropic client the kernel debate uses, adapted to a flat
 * text contract (see `createAnthropicCompositionModelPort`). Injecting it as
 * an interface keeps the engine testable with a deterministic stub.
 */
export interface CompositionModelPort {
  /**
   * Run one completion. Implementations MUST resolve to a string (possibly
   * empty) and MAY throw on transport failure — the engine's oracles catch
   * throws and degrade (empty expansion / zero score), never propagating.
   */
  complete(args: {
    readonly system: string;
    readonly user: string;
    readonly maxTokens?: number;
  }): Promise<string>;
}

// ─────────────────────────────────────────────────────────────────────
// Governance gate port — the SAME fail-closed autonomy decision the route
// already runs, injected so the engine can gate EACH composed step.
// ─────────────────────────────────────────────────────────────────────

/**
 * A per-step authorization decision. Mirrors the route's
 * `decideAutoAuthorization` return — `authorized` is true ONLY when the
 * autonomy controller landed on `auto`; `gate` / `four_eyes` / any deny
 * leaves it false. The engine refuses to auto-execute a composition unless
 * EVERY step authorizes.
 */
export interface StepAuthorizationDecision {
  readonly authorized: boolean;
  readonly reason: string;
  readonly autonomyDecision?: 'auto' | 'gate' | 'four_eyes';
}

/**
 * Injected governance gate. Given the (verb, rationale, scope) for a single
 * composed step, returns whether it may auto-execute. The composition root
 * binds this to `decideAutoAuthorization`; tests inject a deterministic stub
 * to prove the inhibition membrane.
 */
export type StepGovernanceGate = (args: {
  readonly verb: string;
  readonly rationale: string;
  readonly scope: ScopeContext;
}) => StepAuthorizationDecision;

// ─────────────────────────────────────────────────────────────────────
// Engine input + output
// ─────────────────────────────────────────────────────────────────────

/**
 * The attempt input. `verb` + `params` + `rationale` describe the novel
 * need; `scope` is the caller's verified tenant scope (for governance);
 * `ctx` is the `PowerToolContext` (tier + tenant + audit sink) the registry
 * threads into every invoked tool.
 */
export interface CompositionAttemptInput {
  readonly verb: string;
  readonly params: Readonly<Record<string, unknown>>;
  readonly rationale: string;
  readonly scope: ScopeContext;
  readonly ctx: PowerToolContext;
}

/**
 * The successful composed result. Surfaced verbatim to the route as the
 * `result` of a `{ executed:true, composed:true }` envelope. `compose` is
 * the raw transactional `ComposeOutput`; `goal` + `score` + `steps` are the
 * search provenance the FE / audit can render.
 */
export interface ComposedResult {
  readonly kind: 'composed';
  readonly goal: string;
  readonly score: number;
  readonly stepCount: number;
  readonly steps: ReadonlyArray<{ readonly toolId: string }>;
  readonly compose: ComposeOutput;
}

/** Internal — a planned, pre-execution composition the search produced. */
export interface PlannedComposition {
  readonly goal: string;
  readonly score: number;
  readonly composeArgs: ComposeArgs;
}

// ─────────────────────────────────────────────────────────────────────
// The engine surface
// ─────────────────────────────────────────────────────────────────────

/**
 * The Capability-Composition Engine. `attempt` NEVER throws — every failure
 * path (no model, no winning composition, a step that fails governance,
 * oracle/search error, budget overrun, execute error) resolves to `null`,
 * which the route reads as "fall through to the unchanged deferToBrain
 * return".
 */
export interface CapabilityCompositionEngine {
  attempt(input: CompositionAttemptInput): Promise<ComposedResult | null>;
}
