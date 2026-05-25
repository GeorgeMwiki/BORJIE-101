/**
 * Sensor cascade routing — Haiku → Sonnet escalation pattern.
 *
 * Wave 6 CL-2 — designed but not yet deployed. The cascade composes
 * WITH the existing `SensorRouter` failover; it is a higher-level
 * router that decides WHICH MODEL TIER to call first based on stakes
 * and judge confidence, while the underlying `SensorRouter` continues
 * to handle provider-level health, breakers, and capability filtering.
 *
 * Behaviour matrix:
 *
 *   stakes     |  costSensitive  |  first attempt  |  escalation trigger
 *   ─────────────────────────────────────────────────────────────────
 *   low        |  true (default) |  Haiku          |  judge.confidence < threshold
 *                                                  |  OR judge.blocked
 *                                                  |  OR sensor failure
 *   medium     |  true (default) |  Haiku          |  same as low
 *   high       |  N/A (forced)   |  Sonnet         |  never (no escalation)
 *   critical   |  N/A (forced)   |  Sonnet         |  never (no escalation)
 *
 * Escalation paths:
 *   - `low_confidence` — judge returned confidence below threshold
 *   - `judge_blocked`  — judge flagged response as unsafe / off-policy
 *   - `tool_error`     — Haiku sensor itself threw (handed to router for
 *                        provider-level fallback; cascade re-tries on
 *                        Sonnet's preferred sensor id)
 *
 * The cascade NEVER bypasses the underlying router's failover — when
 * the Haiku-preferred call lands on a Haiku sensor whose breaker is
 * open, the router transparently picks the next-priority sensor (which
 * may be Sonnet anyway). The cascade still records the attempt under
 * the model tier it ASKED for, not the one that served.
 *
 * Pure orchestrator. No provider SDK imports.
 */

import type {
  Sensor,
  SensorCallArgs,
  SensorCallResult,
} from './kernel-types.js';
import type { SensorRouter } from './sensor-failover.js';

// ─────────────────────────────────────────────────────────────────────
// Tunables
// ─────────────────────────────────────────────────────────────────────

const DEFAULT_CONFIDENCE_THRESHOLD = 0.7;
const DEFAULT_HAIKU_COST_USD = 0.0008;
const DEFAULT_SONNET_COST_USD = 0.012;

// ─────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────

export type CascadeStakesLevel = 'low' | 'medium' | 'high' | 'critical';

export type CascadeModelTier = 'haiku' | 'sonnet';

export type CascadeEscalationReason =
  | 'low_confidence'
  | 'judge_blocked'
  | 'tool_error';

export interface CascadeAttempt {
  /** Model tier we asked the router to use, e.g. "haiku". */
  readonly tier: CascadeModelTier;
  /** Concrete model id of the sensor that actually served the call. */
  readonly model: string;
  /** Judge-reported (or self-reported) confidence ∈ [0,1]. NaN when no signal. */
  readonly confidence: number;
  /** End-to-end latency for the attempt in ms. */
  readonly latencyMs: number;
  /** Estimated USD cost for the attempt. Producer-side approximation. */
  readonly cost: number;
}

export interface CascadeJudgeOutcome {
  readonly confidence: number;
  readonly blocked: boolean;
}

export type CascadeJudgeFn = (
  response: SensorCallResult,
) => Promise<CascadeJudgeOutcome>;

export interface CascadeMetricsPort {
  recordEscalation(args: {
    readonly from: CascadeModelTier;
    readonly to: CascadeModelTier;
    readonly stakes: CascadeStakesLevel;
    readonly reason: CascadeEscalationReason;
  }): void;
  recordAttempt?(attempt: CascadeAttempt): void;
}

export interface CascadeRouteOptions {
  readonly stakes: CascadeStakesLevel;
  readonly confidenceThreshold?: number;
  /**
   * Default: `true` for low/medium stakes, `false` for high/critical.
   * When `false`, the cascade skips Haiku and goes straight to Sonnet
   * even for low-stakes turns.
   */
  readonly costSensitive?: boolean;
  /**
   * Judge that grades the Haiku response. When `null` / omitted, the
   * cascade falls back to self-reported confidence parsed from the
   * response's `thought` (if present), then to "always escalate" when
   * neither signal is available.
   */
  readonly judgeFn?: CascadeJudgeFn | null;
  /** Optional sensor id pinned to the front of the Haiku attempt. */
  readonly haikuSensorId?: string;
  /** Optional sensor id pinned to the front of the Sonnet attempt. */
  readonly sonnetSensorId?: string;
  /**
   * Capabilities required for each attempt — defaults to `['fast']`.
   * Pass `['vision']` etc. when the turn carries multimodal payload.
   */
  readonly required?: ReadonlyArray<Sensor['capabilities'][number]>;
  /** Optional cost-per-call overrides in USD. */
  readonly haikuCostUsd?: number;
  readonly sonnetCostUsd?: number;
  /** Telemetry sink for escalation + attempt events. */
  readonly metrics?: CascadeMetricsPort;
}

export interface CascadeResult {
  readonly answer: SensorCallResult;
  readonly escalated: boolean;
  readonly attemptedModels: ReadonlyArray<CascadeAttempt>;
  readonly escalationReason?: CascadeEscalationReason;
}

// ─────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────

/**
 * Whether a stakes level forces Sonnet up-front. `high` and `critical`
 * skip Haiku regardless of `costSensitive`.
 */
function stakesForcesSonnet(stakes: CascadeStakesLevel): boolean {
  return stakes === 'high' || stakes === 'critical';
}

/**
 * Default `costSensitive` based on stakes. Critical / high turns are
 * never cost-sensitive — the brand pays Sonnet rates to avoid wrong
 * answers on consequential prompts.
 */
function defaultCostSensitive(stakes: CascadeStakesLevel): boolean {
  return !stakesForcesSonnet(stakes);
}

/**
 * Parse self-reported confidence from a sensor response when no judge
 * is wired. Returns `NaN` when no signal is recoverable so the caller
 * can fall back to the "always escalate" conservative default.
 *
 * Convention: looks for a `"confidence": 0.x` token in the response's
 * thought channel. Mirrors LITFIN's self-grading judge wire format.
 */
function parseSelfReportedConfidence(response: SensorCallResult): number {
  const haystack = response.thought ?? '';
  if (haystack.length === 0) return Number.NaN;
  const match = haystack.match(/"confidence"\s*:\s*([01](?:\.\d+)?)/);
  if (!match) return Number.NaN;
  const parsed = Number.parseFloat(match[1]!);
  if (!Number.isFinite(parsed)) return Number.NaN;
  if (parsed < 0 || parsed > 1) return Number.NaN;
  return parsed;
}

/**
 * Run the judge against the response. If `judgeFn` throws, escalate
 * conservatively — record the throw but report confidence=0, blocked
 * so the cascade routes to Sonnet.
 */
async function gradeResponse(
  response: SensorCallResult,
  judgeFn: CascadeJudgeFn | null | undefined,
): Promise<{ outcome: CascadeJudgeOutcome; threw: boolean }> {
  if (judgeFn == null) {
    const self = parseSelfReportedConfidence(response);
    if (Number.isFinite(self)) {
      return { outcome: { confidence: self, blocked: false }, threw: false };
    }
    // No judge AND no self-report → conservative escalate.
    return { outcome: { confidence: 0, blocked: false }, threw: false };
  }
  try {
    const outcome = await judgeFn(response);
    return { outcome, threw: false };
  } catch {
    // Judge threw — escalate conservatively to Sonnet. The cascade
    // marks the attempt with the recoverable signal (confidence=0).
    return { outcome: { confidence: 0, blocked: true }, threw: true };
  }
}

/**
 * Issue ONE call through the router, capturing latency + recording
 * the attempt. The router itself owns failover within a tier; if every
 * sensor in the tier's pool is down, the router throws and we surface
 * that as `tool_error` to the caller.
 */
async function callTier(args: {
  readonly router: SensorRouter;
  readonly tier: CascadeModelTier;
  readonly sensorArgs: SensorCallArgs;
  readonly required: ReadonlyArray<Sensor['capabilities'][number]>;
  readonly preferred: string | undefined;
  readonly costUsd: number;
  readonly clock: () => number;
}): Promise<{ result: SensorCallResult; attempt: CascadeAttempt }> {
  const started = args.clock();
  // Build the call options literal WITHOUT `preferred: undefined` so
  // the underlying router (which uses `exactOptionalPropertyTypes`)
  // does not see a `string | undefined` value where it expects only
  // `string` or absence.
  const callOptions: { readonly preferred?: string } =
    args.preferred !== undefined ? { preferred: args.preferred } : {};
  const result = await args.router.call(args.sensorArgs, args.required, callOptions);
  const latencyMs = Math.max(0, args.clock() - started);
  const attempt: CascadeAttempt = {
    tier: args.tier,
    model: result.modelId,
    // Confidence is filled in by the cascade after the judge runs;
    // for the raw attempt record we mark NaN. The cascade rewrites
    // the entry once a judge grade is available.
    confidence: Number.NaN,
    latencyMs,
    cost: args.costUsd,
  };
  return { result, attempt };
}

// ─────────────────────────────────────────────────────────────────────
// Public surface — cascadeRoute
// ─────────────────────────────────────────────────────────────────────

export interface CascadeRouteDeps {
  readonly router: SensorRouter;
  readonly clock?: () => number;
}

/**
 * Run a sensor request through the Haiku→Sonnet cascade. Composes with
 * the underlying `SensorRouter` failover — never bypasses provider-
 * level health, breakers, or capability filtering.
 *
 * Behaviour summary:
 *   - low / medium stakes (costSensitive=true): try Haiku first; judge
 *     it; escalate to Sonnet when confidence < threshold OR blocked.
 *   - high / critical stakes: skip Haiku, go straight to Sonnet.
 *   - When the Haiku call ITSELF throws, escalate with reason
 *     `tool_error`; if Sonnet then ALSO throws, the underlying
 *     `SensorFailoverError` propagates.
 */
export async function cascadeRoute(
  request: SensorCallArgs,
  options: CascadeRouteOptions,
  deps: CascadeRouteDeps,
): Promise<CascadeResult> {
  const clock = deps.clock ?? Date.now;
  const threshold = options.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD;
  const costSensitive = options.costSensitive ?? defaultCostSensitive(options.stakes);
  const required = options.required ?? ['fast'];
  const haikuCost = options.haikuCostUsd ?? DEFAULT_HAIKU_COST_USD;
  const sonnetCost = options.sonnetCostUsd ?? DEFAULT_SONNET_COST_USD;
  const metrics = options.metrics;
  const judgeFn = options.judgeFn;

  // Skip Haiku entirely for high/critical OR when cost-sensitivity is off.
  if (stakesForcesSonnet(options.stakes) || !costSensitive) {
    const { result, attempt } = await callTier({
      router: deps.router,
      tier: 'sonnet',
      sensorArgs: request,
      required,
      preferred: options.sonnetSensorId,
      costUsd: sonnetCost,
      clock,
    });
    metrics?.recordAttempt?.(attempt);
    return {
      answer: result,
      escalated: false,
      attemptedModels: [attempt],
    };
  }

  // Cost-sensitive path: try Haiku first.
  const attempts: CascadeAttempt[] = [];
  let haikuResult: SensorCallResult | null = null;
  let haikuAttempt: CascadeAttempt | null = null;
  let toolError: unknown = null;

  try {
    const out = await callTier({
      router: deps.router,
      tier: 'haiku',
      sensorArgs: request,
      required,
      preferred: options.haikuSensorId,
      costUsd: haikuCost,
      clock,
    });
    haikuResult = out.result;
    haikuAttempt = out.attempt;
  } catch (err) {
    toolError = err;
  }

  if (toolError !== null || haikuResult === null) {
    // Haiku tier threw — record the failed attempt with NaN latency
    // and escalate to Sonnet.
    const failed: CascadeAttempt = {
      tier: 'haiku',
      model: 'unknown',
      confidence: 0,
      latencyMs: 0,
      cost: haikuCost,
    };
    attempts.push(failed);
    metrics?.recordAttempt?.(failed);
    metrics?.recordEscalation({
      from: 'haiku',
      to: 'sonnet',
      stakes: options.stakes,
      reason: 'tool_error',
    });
    return await escalateToSonnet({
      attempts,
      reason: 'tool_error',
      router: deps.router,
      sensorArgs: request,
      required,
      preferred: options.sonnetSensorId,
      sonnetCost,
      clock,
      metrics,
    });
  }

  // Haiku succeeded — grade it.
  const graded = await gradeResponse(haikuResult, judgeFn);
  const gradedAttempt: CascadeAttempt = {
    ...haikuAttempt!,
    confidence: graded.outcome.confidence,
  };
  attempts.push(gradedAttempt);
  metrics?.recordAttempt?.(gradedAttempt);

  // Decide escalation.
  const blocked = graded.outcome.blocked;
  const lowConfidence = graded.outcome.confidence < threshold;
  if (!blocked && !lowConfidence) {
    return {
      answer: haikuResult,
      escalated: false,
      attemptedModels: attempts,
    };
  }

  // judgeFn threw AND we coerced to blocked=true above — preserve a
  // distinct `judge_blocked` reason rather than mislabelling as
  // tool_error since the SENSOR call itself was fine.
  const reason: CascadeEscalationReason = blocked ? 'judge_blocked' : 'low_confidence';
  metrics?.recordEscalation({
    from: 'haiku',
    to: 'sonnet',
    stakes: options.stakes,
    reason,
  });
  return await escalateToSonnet({
    attempts,
    reason,
    router: deps.router,
    sensorArgs: request,
    required,
    preferred: options.sonnetSensorId,
    sonnetCost,
    clock,
    metrics,
  });
}

interface EscalateArgs {
  readonly attempts: CascadeAttempt[];
  readonly reason: CascadeEscalationReason;
  readonly router: SensorRouter;
  readonly sensorArgs: SensorCallArgs;
  readonly required: ReadonlyArray<Sensor['capabilities'][number]>;
  readonly preferred: string | undefined;
  readonly sonnetCost: number;
  readonly clock: () => number;
  readonly metrics: CascadeMetricsPort | undefined;
}

/**
 * Run the Sonnet half of the cascade. If THIS throws, the
 * `SensorFailoverError` propagates — degraded mode is the underlying
 * router's job, not the cascade's.
 */
async function escalateToSonnet(args: EscalateArgs): Promise<CascadeResult> {
  const { result, attempt } = await callTier({
    router: args.router,
    tier: 'sonnet',
    sensorArgs: args.sensorArgs,
    required: args.required,
    preferred: args.preferred,
    costUsd: args.sonnetCost,
    clock: args.clock,
  });
  const finalAttempts: CascadeAttempt[] = [...args.attempts, attempt];
  args.metrics?.recordAttempt?.(attempt);
  return {
    answer: result,
    escalated: true,
    attemptedModels: finalAttempts,
    escalationReason: args.reason,
  };
}
