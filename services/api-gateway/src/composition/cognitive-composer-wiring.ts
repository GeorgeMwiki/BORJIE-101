/**
 * Cognitive composer wiring — LP-01.
 *
 * Background
 * ----------
 * `cognitive-wiring.ts` historically pinned `composition: null`, so the
 * 12-wire deep-reasoning composer (`@borjie/cognitive-composition`) NEVER
 * ran in production even though LATS, Self-Discover, ToT, GoT, SoT and the
 * PRM were imported and unit-tested. This module turns that light on:
 *
 *   1. It builds the real `cognitive-composition` composer via
 *      `createCognitiveComposition(deps)`.
 *   2. It routes each turn through the kernel's TTC allocator
 *      (`@borjie/central-intelligence` `allocateTtc`):
 *        - stakes/ambiguity in the 0.5..0.8 band → Self-Discover scaffold
 *          (reasoning-substrate SELECT/ADAPT/IMPLEMENT).
 *        - hard edge (critical stakes or very high ambiguity) → LATS
 *          (MCTS over LLM rollouts).
 *        - otherwise → fast path (no deep composer).
 *   3. It is env-flag-gated by `BORJIE_COGNITIVE_COMPOSER_ENABLED` and is
 *      FAIL-SAFE: on ANY composer error it falls back to the existing
 *      memory-recall-only enrichment; it NEVER throws into the hot path.
 *
 * Dependency boundary
 * -------------------
 * The api-gateway has `@borjie/cognitive-composition` + `@borjie/central-
 * intelligence` as workspace deps, but NOT `@borjie/extended-reasoning` /
 * `@borjie/reasoning-substrate` (those would need a package.json change +
 * install, which the wave-runner does not perform). The DEEP execution of
 * `runLATS` / `discoverReasoningStructure` is therefore injected as a
 * `ReasoningExecutorPort`. The serial pass (which can run install) binds
 * the real executor by adding the two deps; until then the default
 * executor delegates to the composer's own substrate/cot ports so the
 * composer pipeline still runs end-to-end (closing the "never runs" gap).
 *
 * Immutability: pure inputs, frozen results, no mutation of caller state.
 * Logging: structured logger only (no console.*).
 *
 * @module services/api-gateway/src/composition/cognitive-composer-wiring
 */

import {
  createCognitiveComposition,
  type CognitiveComposition,
  type CompositionDeps,
  type CognitiveOutput,
} from '@borjie/cognitive-composition';
import { allocateTtc, type TtcAllocatorInput } from '@borjie/central-intelligence';

import type { CognitiveLogger } from './cognitive-wiring.js';

// ---------------------------------------------------------------------------
// Reasoning strategy selection (TTC-routed)
// ---------------------------------------------------------------------------

export type ReasoningStrategy = 'fast' | 'self-discover' | 'lats';

export interface RouteReasoningInput {
  readonly stakes: TtcAllocatorInput['stakes'];
  readonly surface: TtcAllocatorInput['surface'];
  /** Ambiguity / difficulty score in [0,1] from the normaliser. */
  readonly ambiguityScore?: number;
  readonly costCeilingUsd?: number;
  readonly requireJudge?: boolean;
}

export interface ReasoningRoute {
  readonly strategy: ReasoningStrategy;
  readonly cognitionMode: ReturnType<typeof allocateTtc>['cognitionMode'];
  readonly budgetUsd: number;
  readonly reason: string;
}

/**
 * Hard-edge threshold. Above this difficulty (or at critical stakes) we
 * escalate to LATS — the branching tree search pays off only on genuinely
 * hard, multi-step decisions (licence renewal, offtake, capex).
 */
const LATS_DIFFICULTY_EDGE = 0.8;
/** Lower bound of the Self-Discover band (per LP-01 spec: 0.5..0.8). */
const SELF_DISCOVER_LOWER = 0.5;

/**
 * Route a turn to a reasoning strategy using the SAME TTC allocation the
 * kernel uses for `wantsThinking`. Pure + deterministic.
 *
 *   - critical stakes OR ambiguity > 0.8 → LATS (hard edge)
 *   - ambiguity in [0.5, 0.8] AND mode is at least 'deliberate' →
 *     Self-Discover
 *   - else → fast (no deep composer; memory-recall enrichment only)
 */
export function routeReasoning(input: RouteReasoningInput): ReasoningRoute {
  const ambiguity = clamp01(input.ambiguityScore ?? 0);
  const ttc = allocateTtc({
    stakes: input.stakes,
    surface: input.surface,
    ambiguityScore: ambiguity,
    ...(input.costCeilingUsd !== undefined
      ? { costCeilingUsd: input.costCeilingUsd }
      : {}),
    ...(input.requireJudge !== undefined
      ? { requireJudge: input.requireJudge }
      : {}),
  });

  const isHardEdge = input.stakes === 'critical' || ambiguity > LATS_DIFFICULTY_EDGE;
  if (isHardEdge) {
    return Object.freeze({
      strategy: 'lats' as const,
      cognitionMode: ttc.cognitionMode,
      budgetUsd: ttc.budgetUsd,
      reason:
        input.stakes === 'critical'
          ? 'critical stakes -> LATS tree search'
          : `ambiguity ${ambiguity.toFixed(2)} > ${String(LATS_DIFFICULTY_EDGE)} -> LATS`,
    });
  }

  const inSelfDiscoverBand =
    ambiguity >= SELF_DISCOVER_LOWER && ttc.cognitionMode !== 'fast';
  if (inSelfDiscoverBand) {
    return Object.freeze({
      strategy: 'self-discover' as const,
      cognitionMode: ttc.cognitionMode,
      budgetUsd: ttc.budgetUsd,
      reason: `ambiguity ${ambiguity.toFixed(2)} in [${String(SELF_DISCOVER_LOWER)}, ${String(LATS_DIFFICULTY_EDGE)}] -> Self-Discover`,
    });
  }

  return Object.freeze({
    strategy: 'fast' as const,
    cognitionMode: ttc.cognitionMode,
    budgetUsd: ttc.budgetUsd,
    reason: 'low stakes / ambiguity -> fast path (memory recall only)',
  });
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

// ---------------------------------------------------------------------------
// Flag gate
// ---------------------------------------------------------------------------

export const COGNITIVE_COMPOSER_FLAG = 'BORJIE_COGNITIVE_COMPOSER_ENABLED';

/**
 * Resolve the composer flag from an env-like record. LP-30 flipped the
 * default to ON now that the reasoning packages (`@borjie/extended-reasoning`
 * + `@borjie/reasoning-substrate`) are wired and the executor is fail-safe
 * (any composer error falls back to memory-recall-only enrichment — see
 * `wireCognitiveComposer.runForTurn`). Only the literal `'0'` / `'false'` /
 * `'off'` disables it, so operators can still kill the deep composer without
 * a redeploy.
 */
export function isCognitiveComposerEnabled(
  env: Readonly<Record<string, string | undefined>>,
): boolean {
  const raw = env[COGNITIVE_COMPOSER_FLAG]?.trim().toLowerCase();
  return !(raw === '0' || raw === 'false' || raw === 'off');
}

// ---------------------------------------------------------------------------
// Composer bundle
// ---------------------------------------------------------------------------

export interface WiredCognitiveComposer {
  /** The underlying 12-wire composition pipeline. */
  readonly composition: CognitiveComposition;
  /** Whether the env flag enabled the composer at boot. */
  readonly enabled: boolean;
  /**
   * Run the deep composer for a turn, routed via TTC. NEVER throws.
   * Returns `null` when the strategy is 'fast', the flag is disabled, or
   * the composer errored (caller then uses memory-recall-only enrichment).
   */
  readonly runForTurn: (args: RunComposerArgs) => Promise<ComposerTurnResult | null>;
}

export interface RunComposerArgs {
  readonly tenantId: string;
  readonly turnId: string;
  readonly userMessage: string;
  readonly stakes: TtcAllocatorInput['stakes'];
  readonly surface: TtcAllocatorInput['surface'];
  readonly ambiguityScore?: number;
  readonly costCeilingUsd?: number;
  readonly requireJudge?: boolean;
  readonly logger?: CognitiveLogger;
}

export interface ComposerTurnResult {
  readonly route: ReasoningRoute;
  readonly output: CognitiveOutput;
}

export interface WireCognitiveComposerDeps {
  /**
   * The 10 cognitive-composition ports. The api-gateway composition root
   * supplies these (in-memory / degraded adapters are acceptable until the
   * production cognitive-engine + brain-router adapters land); this module
   * does not construct them so it stays free of heavy deps.
   */
  readonly compositionDeps: CompositionDeps;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly logger: CognitiveLogger;
}

/**
 * Build the wired composer. Never throws — a construction failure degrades
 * `runForTurn` to a permanent no-op (returns null) and is logged.
 */
export function wireCognitiveComposer(
  deps: WireCognitiveComposerDeps,
): WiredCognitiveComposer | null {
  const enabled = isCognitiveComposerEnabled(deps.env);
  let composition: CognitiveComposition;
  try {
    composition = createCognitiveComposition(deps.compositionDeps);
  } catch (err) {
    deps.logger.warn(
      'cognitive-composer-wiring: createCognitiveComposition failed; composer disabled',
      { error: err instanceof Error ? err.message : String(err) },
    );
    return null;
  }

  const runForTurn = async (
    args: RunComposerArgs,
  ): Promise<ComposerTurnResult | null> => {
    const logger = args.logger ?? deps.logger;
    if (!enabled) return null;

    const route = routeReasoning({
      stakes: args.stakes,
      surface: args.surface,
      ...(args.ambiguityScore !== undefined
        ? { ambiguityScore: args.ambiguityScore }
        : {}),
      ...(args.costCeilingUsd !== undefined
        ? { costCeilingUsd: args.costCeilingUsd }
        : {}),
      ...(args.requireJudge !== undefined
        ? { requireJudge: args.requireJudge }
        : {}),
    });

    // Fast path: do not spin the deep composer; the caller keeps the
    // cheaper memory-recall-only enrichment.
    if (route.strategy === 'fast') return null;

    try {
      const output = await composition.compose({
        tenantId: args.tenantId,
        turnId: args.turnId,
        userMessage: args.userMessage,
      });
      logger.info('cognitive-composer-wiring: deep compose complete', {
        strategy: route.strategy,
        cognitionMode: route.cognitionMode,
        confidenceLabel: output.confidenceLabel,
        wireStatus: output.wireStatus,
      });
      return Object.freeze({ route, output });
    } catch (err) {
      // FAIL-SAFE: any composer error falls back to memory-recall-only.
      logger.warn(
        'cognitive-composer-wiring: deep compose failed; falling back to memory-recall-only',
        {
          strategy: route.strategy,
          error: err instanceof Error ? err.message : String(err),
        },
      );
      return null;
    }
  };

  return Object.freeze({ composition, enabled, runForTurn });
}

// ---------------------------------------------------------------------------
// Internal exports for tests
// ---------------------------------------------------------------------------

export const __testables = Object.freeze({
  LATS_DIFFICULTY_EDGE,
  SELF_DISCOVER_LOWER,
  clamp01,
});
