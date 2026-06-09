/**
 * routing-config/config-model.ts — the typed CONTROL-PLANE config model.
 *
 * This is the admin-set, DB-backed configuration that makes model selection
 * config-driven. It is read at the brain-call seam and at the ensemble seam.
 * Everything here is storage-agnostic: the shape is shared by the in-memory
 * adapter (tests / bootstrap) and the Drizzle adapter (api-gateway).
 *
 * THREE knobs the Borjie internal admin console controls:
 *   1. POWER FLAGS  — capability / kill-switch toggles (global + per-tenant).
 *   2. LLM ROUTING  — core model + ordered fallback chain + ensemble +
 *                     per-use-case routing.
 *   3. (AI-SUGGEST is a pure recommender that proposes routing — it never
 *      writes; the admin applies via the routing config write path. HITL.)
 *
 * HARD INVARIANTS encoded by construction:
 *   - The config can change WHICH model answers, never WHETHER a sovereign
 *     action (money / licence / deletion) executes — there is no field here
 *     that can disable an HITL rail. Those rails live in the policy-gate, not
 *     here.
 *   - LOCKED_CATEGORIES + the min-tier policy remain authoritative: a config
 *     row for a locked use-case is dropped on resolve (see resolver.ts).
 *   - Immutable: every value is `Readonly<...>`; resolvers defensively copy.
 *
 * Pure module: no I/O, no mutation.
 */

import type { ModelTier } from '../types.js';

// ─────────────────────────── Scope ─────────────────────────────────

/**
 * Config scope. `'global'` is the platform-wide default; `tenant:<id>` is a
 * per-tenant override that supersedes global for that tenant. Mirrors the
 * `platform_feature_flags` scope convention exactly so the two stores read
 * the same way.
 */
export type ConfigScope = 'global' | `tenant:${string}`;

export function tenantScope(tenantId: string): ConfigScope {
  return `tenant:${tenantId}`;
}

export function parseTenantFromScope(scope: string): string | null {
  if (scope === 'global') return null;
  if (scope.startsWith('tenant:')) return scope.slice('tenant:'.length);
  return null;
}

// ─────────────────────────── Power flags ───────────────────────────

/**
 * A single capability / kill-switch flag. `enabled` is the resolved boolean
 * for the given scope. These are the FLAG_ACTIVATION_PLAN flags surfaced to
 * the admin POWERS grid.
 *
 * SEMANTICS: a power flag changes WHETHER a capability is offered, never the
 * sovereign-rail HITL gate. The admin route layer must reject any attempt to
 * flag-write a sovereign `killswitch_*` rail (those stay operator-only).
 */
export interface PowerFlag {
  readonly flag: string;
  readonly enabled: boolean;
  readonly scope: ConfigScope;
}

// ─────────────────────── Ensemble config ───────────────────────────

/**
 * Combine strategy for an all-at-once ensemble run. N members run in
 * PARALLEL; the strategy decides how their outputs collapse to one answer.
 *
 *   - 'first-wins'      : fastest non-error response wins (latency-optimal).
 *   - 'majority-vote'   : majority of normalised text answers (accuracy lift).
 *   - 'judge-synthesis' : a judge model synthesises a single best answer.
 *   - 'debate'          : members critique then a synthesiser reconciles.
 */
export type CombineStrategy =
  | 'first-wins'
  | 'majority-vote'
  | 'judge-synthesis'
  | 'debate';

export const ALL_COMBINE_STRATEGIES: readonly CombineStrategy[] = Object.freeze([
  'first-wins',
  'majority-vote',
  'judge-synthesis',
  'debate',
]);

export function isCombineStrategy(value: unknown): value is CombineStrategy {
  return (
    typeof value === 'string' &&
    (ALL_COMBINE_STRATEGIES as readonly string[]).includes(value)
  );
}

/**
 * The ensemble (orchestrative all-at-once) config. When `enabled`, the
 * brain-call ensemble seam fans the turn to `members` in parallel and
 * combines per `strategy`. `judgeModel` is required for `judge-synthesis`
 * and `debate`; the resolver falls back to the first member if absent.
 *
 * COST-AWARE: N members == N x cost. The orchestrator consults the budget
 * governor BEFORE fan-out and degrades to a single model when constrained.
 */
export interface EnsembleConfig {
  readonly enabled: boolean;
  readonly members: readonly ModelTier[];
  readonly combineStrategy: CombineStrategy;
  readonly judgeModel?: ModelTier;
}

// ─────────────────────── LLM routing config ────────────────────────

/**
 * The full routing config for a scope.
 *
 *   - `coreModel`        — the primary model that answers first.
 *   - `orderedFallbacks` — the ordered failover chain (try core; on
 *                          error/timeout cascade these in order).
 *   - `ensemble`         — optional all-at-once orchestration.
 *   - `perUseCase`       — task/surface use-case → model id (a thin
 *                          per-use-case routing layer; locked use-cases are
 *                          dropped at resolve time).
 *
 * The resolved ladder for a turn is `[coreModel, ...orderedFallbacks]`,
 * unless a per-use-case entry overrides the core for that use-case.
 */
export interface LlmRoutingConfig {
  readonly coreModel: ModelTier;
  readonly orderedFallbacks: readonly ModelTier[];
  readonly ensemble?: EnsembleConfig;
  readonly perUseCase?: Readonly<Record<string, ModelTier>>;
}

/**
 * The merged, ready-to-consume config object the resolver returns. `scope`
 * records which scope won (tenant override vs global). Always frozen.
 */
export interface ResolvedRoutingConfig {
  readonly scope: ConfigScope;
  readonly routing: LlmRoutingConfig;
}

// ─────────────────────────── Helpers ───────────────────────────────

/**
 * Flatten a routing config into the ordered ladder consumed by the
 * provider-fallback iterator: `[core, ...fallbacks]`, de-duplicated while
 * preserving order. Returns a frozen array.
 */
export function ladderFromRouting(
  routing: LlmRoutingConfig,
): readonly ModelTier[] {
  const seen = new Set<ModelTier>();
  const out: ModelTier[] = [];
  for (const m of [routing.coreModel, ...routing.orderedFallbacks]) {
    if (typeof m !== 'string' || m.trim().length === 0) continue;
    if (seen.has(m)) continue;
    seen.add(m);
    out.push(m);
  }
  return Object.freeze(out);
}
