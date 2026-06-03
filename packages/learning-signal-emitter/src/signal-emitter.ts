/**
 * Signal emitter.
 *
 * Given an (ActionEvent, OutcomeEvent), the emitter:
 *   1. Scores the pair via the reward model.
 *   2. Builds an immutable LearningSignal (with a stable idempotency hash).
 *   3. Runs the per-tier isolation gate.
 *   4. Fans the signal out to every injected sink that opted in:
 *        belief / reflexion / mastery / pattern / persona-prompt / preference.
 *
 * The emitter NEVER writes a belief directly (CLAUDE.md hard rule). The
 * belief sink wraps the belief-engine's convince-loop, which is the sole
 * authorised writer; the emitter just hands it the signal and lets the
 * 0.25 gate decide.
 *
 * The emitter never throws — sink failures (DB blip, missing belief) are
 * absorbed into `notes` so the calling action never crashes.
 *
 * Ported from LITFIN learning/signal-emitter.ts.
 */

import { createHash } from 'node:crypto';

import { scoreAction, DEFAULT_WEIGHTS } from './reward-model.js';
import { enforceIsolation } from './per-tier-isolation.js';
import type {
  ActionEvent,
  EmissionResult,
  LearningSignal,
  OutcomeEvent,
  RewardWeights,
  SignalRoute,
  TenantScope,
} from './types.js';

const EMITTER_ID = 'borjie-signal-emitter:v1';

/**
 * Reward thresholds for the router. The reward model's positive components
 * (sla 0.30 + cost 0.025 + satisfaction 0.10) cap the maximum positive reward
 * at ~0.425 — override / complaint / regulator only ever subtract — so the
 * belief-strengthen floor is set BELOW that ceiling at 0.35: a clear SLA win
 * paired with one more positive signal strengthens a belief, while a lone
 * weak positive does not. Negative decisions (< 0.3) record a Reflexion
 * lesson. Keep these in sync with reward-model.ts if its weights change.
 */
const POSITIVE_REWARD_FLOOR = 0.35;
const NEGATIVE_REWARD_CEILING = 0.3;

/**
 * Plug-in surface. Each downstream learning primitive exposes a tiny adapter
 * so the emitter never reaches into module internals. Adapters return `true`
 * when they accepted the signal so the result carries an accurate `routedTo`.
 * An undefined return / absent adapter means "not configured" — not a failure.
 */
export interface SignalSinks {
  readonly beliefStrengthen?: (s: LearningSignal) => Promise<boolean>;
  readonly reflexionRecord?: (s: LearningSignal) => Promise<boolean>;
  readonly masteryUpdate?: (s: LearningSignal) => Promise<boolean>;
  readonly patternStore?: (s: LearningSignal) => Promise<boolean>;
  readonly personaPrompt?: (s: LearningSignal) => Promise<boolean>;
  readonly preferenceLearner?: (s: LearningSignal) => Promise<boolean>;
}

export interface EmitInput {
  readonly action: ActionEvent;
  readonly outcome: OutcomeEvent;
  readonly weights?: RewardWeights;
  readonly sinks?: SignalSinks;
  readonly cohortSize?: number;
  readonly kAnonymity?: number;
}

/**
 * Stable, opaque hash of (actionRef, outcomeRef, reward). Two identical
 * re-emits collide so the UNIQUE constraint on learning_signals.signal_hash
 * absorbs the dupe at insert time. PURE.
 */
export function buildSignalHash(args: {
  readonly actionRef: string;
  readonly outcomeRef?: string;
  readonly reward: number;
}): string {
  const corpus = `${args.actionRef}|${args.outcomeRef ?? ''}|${args.reward.toFixed(6)}`;
  return createHash('sha256').update(corpus).digest('hex').slice(0, 32);
}

/** Resolve the tenant scope from the action shape. */
function resolveTenantScope(action: ActionEvent): TenantScope {
  if (action.tenantUserId) return 'user';
  if (action.tenantOrgId) return 'org';
  return 'platform';
}

/** Compose the LearningSignal. PURE. */
export function buildSignal(input: {
  readonly action: ActionEvent;
  readonly outcome: OutcomeEvent;
  // `| undefined` (not just `?`) so callers may forward an optional value
  // under exactOptionalPropertyTypes without re-shaping the object.
  readonly weights?: RewardWeights | undefined;
}): LearningSignal {
  const scored = scoreAction({
    action: input.action,
    outcome: input.outcome,
    weights: input.weights ?? DEFAULT_WEIGHTS,
  });
  const scope = resolveTenantScope(input.action);
  const hash = buildSignalHash({
    actionRef: input.action.id,
    outcomeRef: input.outcome.id,
    reward: scored.reward,
  });
  return Object.freeze({
    signalHash: hash,
    actionRef: input.action.id,
    actionKind: input.action.kind,
    outcomeRef: input.outcome.id,
    reward: scored.reward,
    components: scored.components,
    tenantScope: scope,
    subjectUserId: input.action.tenantUserId ?? null,
    subjectOrgId: input.action.tenantOrgId ?? null,
    emittedBy: EMITTER_ID,
    decisionTraceId: input.action.decisionTraceId ?? null,
    capturedAt: input.action.capturedAt,
  });
}

/**
 * Decide which sinks to call given the reward + the action kind. Returns the
 * ORDERED route list so fan-out is deterministic. PURE.
 */
export function routePlan(signal: LearningSignal): ReadonlyArray<SignalRoute> {
  const routes: SignalRoute[] = [];
  const r = signal.reward;
  if (r >= POSITIVE_REWARD_FLOOR) {
    routes.push('belief-store');
  }
  if (r < NEGATIVE_REWARD_CEILING) {
    const decisionish: ReadonlyArray<string> = [
      'decide',
      'approve',
      'reject',
      'dispatch',
      'appraisal',
    ];
    if (decisionish.includes(signal.actionKind)) {
      routes.push('reflexion-lessons');
    }
  }
  // Mastery + pattern store always fire — they accumulate evidence
  // regardless of sign.
  routes.push('mastery-tracker');
  routes.push('pattern-store');
  // Persona prompt revision queues only on a clear negative signal.
  if (signal.components.override < 0 || signal.components.complaint < 0) {
    routes.push('persona-prompt-bridge');
  }
  // Preference learner needs a paired variant; surface the route but it only
  // fires when the caller supplied a preferenceLearner sink.
  routes.push('preference-learner');
  return routes;
}

/**
 * Emit a signal: score → build → isolation-gate → fan out. Never throws.
 */
export async function emitSignal(input: EmitInput): Promise<EmissionResult> {
  const signal = buildSignal({
    action: input.action,
    outcome: input.outcome,
    weights: input.weights,
  });
  const isolation = enforceIsolation({
    signal,
    cohortSize: input.cohortSize,
    kAnonymity: input.kAnonymity,
  });
  const notes: string[] = [];
  if (!isolation.ok) {
    notes.push(`isolation blocked: ${isolation.reason}`);
    return Object.freeze({
      signal,
      routedTo: Object.freeze(['isolation-blocked'] as ReadonlyArray<SignalRoute>),
      notes: Object.freeze(notes),
    });
  }
  const plan = routePlan(signal);
  const accepted: SignalRoute[] = [];
  const sinks = input.sinks ?? {};

  for (const route of plan) {
    try {
      const ok = await dispatch(route, signal, sinks);
      if (ok === true) accepted.push(route);
      else if (ok === false) notes.push(`route ${route} declined`);
      // undefined => sink not configured; not a failure
    } catch (err) {
      notes.push(
        `route ${route} threw: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  if (accepted.length === 0) accepted.push('no-route');

  return Object.freeze({
    signal,
    routedTo: Object.freeze(accepted),
    notes: Object.freeze(notes),
  });
}

async function dispatch(
  route: SignalRoute,
  signal: LearningSignal,
  sinks: SignalSinks,
): Promise<boolean | undefined> {
  switch (route) {
    case 'belief-store':
      return sinks.beliefStrengthen?.(signal);
    case 'reflexion-lessons':
      return sinks.reflexionRecord?.(signal);
    case 'mastery-tracker':
      return sinks.masteryUpdate?.(signal);
    case 'pattern-store':
      return sinks.patternStore?.(signal);
    case 'persona-prompt-bridge':
      return sinks.personaPrompt?.(signal);
    case 'preference-learner':
      return sinks.preferenceLearner?.(signal);
    case 'isolation-blocked':
    case 'no-route':
      return undefined;
  }
}
