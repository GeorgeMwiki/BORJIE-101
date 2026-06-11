/**
 * Counterfactual Self-Check Gate — pre-act "what if I'm wrong?" critique.
 *
 * Frontier-addendum upgrade #10 ("Counterfactual self-checking gate
 * '“what if my evidence_id is wrong?”' even when the flow is auto").
 * Before an autonomous high-consequence action commits, the MD generates
 * a SHORT counterfactual critique of its OWN reasoning:
 *
 *   "If my key evidence_id / assumption is wrong, what is the downside,
 *    and is it reversible?"
 *
 * The critique actively decides proceed-vs-revise-vs-ESCALATE in the
 * moment — EVEN when the flow's autonomy posture is AUTO. The check is
 * the perfect partner to Borjie's evidence-required rule + Auditor Agent
 * (auditor-agent.ts): the Auditor verifies the evidence chain is NON-
 * EMPTY; THIS gate asks the orthogonal question "what if that evidence
 * is wrong?" on an irreversible money / metallurgy / licence decision.
 *
 * ── COMPOSITION WITH THE RAILS (ABSOLUTE) ──────────────────────────────
 * This module is ADDITIVE. It NEVER touches policy-gate.ts, inviolable.ts,
 * or the LedgerService money path. It feeds the autonomy-controller a
 * `counterfactualRisk` signal that can only ADD gating, never remove it:
 *
 *   - A rail GATE (sovereign / money / four_eye / kill_switch /
 *     policy_rollout) ALWAYS wins — this gate cannot downgrade it.
 *   - This gate can ESCALATE an otherwise-auto action to gated when the
 *     downside of being wrong is high AND irreversible.
 *   - It can NEVER turn a gated action into an auto one.
 *
 * The decision is monotone-increasing in gating: `escalate` ⊐ `revise`
 * ⊐ `proceed`, and the caller takes max(railDecision, thisDecision).
 *
 * ── BRAIN PORT (no SDK) ────────────────────────────────────────────────
 * The LLM critique runs through the injected `ClaudeClient` port from
 * `_shared.ts` — zero Anthropic SDK imports here. A deterministic
 * pre-floor runs FIRST and is authoritative for the irreversible×high-
 * downside corner, so the gate is safe even when the brain is
 * unavailable (fail-closed: brain error ⇒ escalate, never proceed).
 */

import { z } from 'zod';
import {
  buildUniversalPrompt,
  defaultJuniorDeps,
  parseClaudeJson,
  withResolvedDb,
  type ClaudeClient,
  type JuniorDeps,
  type JuniorLogger,
} from './_shared.js';
import { resolveTierModelId } from '../model-resolution.js';

// ─────────────────────────────────────────────────────────────────────
// Risk taxonomy — the signal fed to the autonomy-controller
// ─────────────────────────────────────────────────────────────────────

/** Coarse band consumed by dashboards + the autonomy-controller. */
export const CounterfactualRiskBand = z.enum(['low', 'medium', 'high']);
export type CounterfactualRiskBand = z.infer<typeof CounterfactualRiskBand>;

/**
 * Gate decision — monotone-increasing in gating strength.
 *   proceed  — downside is low or fully reversible; auto flow may run.
 *   revise   — downside is non-trivial but reversible; ask the junior to
 *              re-ground (gather more evidence) before acting.
 *   escalate — downside is high AND irreversible; force human gating EVEN
 *              in an auto flow. The autonomy-controller must gate.
 */
export const CounterfactualGateDecision = z.enum(['proceed', 'revise', 'escalate']);
export type CounterfactualGateDecision = z.infer<typeof CounterfactualGateDecision>;

const GATE_RANK: Readonly<Record<CounterfactualGateDecision, number>> = Object.freeze({
  proceed: 0,
  revise: 1,
  escalate: 2,
});

/**
 * Returns the STRONGER (more-gating) of two decisions. Used by the
 * caller to compose this gate with the rail decision — gating only ever
 * increases, never decreases.
 */
export function maxGateDecision(
  a: CounterfactualGateDecision,
  b: CounterfactualGateDecision,
): CounterfactualGateDecision {
  return GATE_RANK[a] >= GATE_RANK[b] ? a : b;
}

// ─────────────────────────────────────────────────────────────────────
// Reversibility × downside — the 2-D surface the gate reasons over
// ─────────────────────────────────────────────────────────────────────

/**
 * How undoable the action is once committed. Mirrors the frontier
 * 2-D reversibility×blast-radius surface (addendum upgrade #2) — kept
 * local + minimal so this module has no kernel dependency.
 *   reversible           — a draft / pending state, trivially rolled back.
 *   reversible-with-cost — undoable but with real friction (recall a
 *                          notice, reverse a non-final transfer).
 *   irreversible         — once done it cannot be undone (money posted,
 *                          licence surrendered, record deleted, blast).
 */
export const Reversibility = z.enum([
  'reversible',
  'reversible-with-cost',
  'irreversible',
]);
export type Reversibility = z.infer<typeof Reversibility>;

/**
 * The blast radius if the action's grounding turns out wrong — how bad
 * the realised downside is, independent of reversibility.
 */
export const DownsideSeverity = z.enum(['low', 'moderate', 'high', 'severe']);
export type DownsideSeverity = z.infer<typeof DownsideSeverity>;

const SEVERITY_RANK: Readonly<Record<DownsideSeverity, number>> = Object.freeze({
  low: 0,
  moderate: 1,
  high: 2,
  severe: 3,
});

// ─────────────────────────────────────────────────────────────────────
// Input — the proposed high-consequence autonomous action
// ─────────────────────────────────────────────────────────────────────

export const CounterfactualCheckInput = z.object({
  tenantId: z.string().min(1),
  /** Originating junior (metallurgy-agent, fx-treasury-agent, …). */
  origin_junior: z.string().min(1),
  /** Stable id of the action / recommendation under self-check. */
  action_id: z.string().min(1),
  /** One-line description of what the action does. */
  action_summary: z.string().min(1),
  /**
   * The evidence_ids the action's reasoning rests on. Empty is itself a
   * hard escalate — there is nothing to be "wrong" about, so the brain is
   * acting blind (this complements the Auditor's empty-evidence reject).
   */
  evidence_ids: z.array(z.string()).default([]),
  /**
   * The single load-bearing assumption the action depends on, in the
   * junior's own words ("the M-Pesa transfer settles same-day", "the
   * assay grade of 4.2 g/t is final"). The counterfactual negates THIS.
   */
  key_assumption: z.string().min(1),
  /** How undoable the action is once committed. */
  reversibility: Reversibility,
  /** How bad the downside is if `key_assumption` is wrong. */
  downside_severity: DownsideSeverity,
  /**
   * The junior's calibrated confidence in `key_assumption` (0-1). Lower
   * confidence on an irreversible action pulls the gate toward escalate.
   */
  confidence: z.number().min(0).max(1),
  /**
   * The autonomy posture the flow WOULD run at absent this gate. The gate
   * only matters when this is 'auto' — a 'gated' action is already gated
   * and this signal can only confirm it.
   */
  flow_posture: z.enum(['auto', 'gated']).default('auto'),
});
export type CounterfactualCheckInput = z.infer<typeof CounterfactualCheckInput>;

// ─────────────────────────────────────────────────────────────────────
// LLM critique sub-schema (what the brain returns)
// ─────────────────────────────────────────────────────────────────────

const LlmCritiqueSchema = z.object({
  /** The negated-assumption scenario the brain reasoned over. */
  counterfactual: z.string().min(1),
  /** Plain-language downside if the assumption is wrong. */
  downside_if_wrong: z.string().min(1),
  /** Whether the brain judges the consequence recoverable. */
  recoverable: z.boolean(),
  /** Brain's own recommended gate decision. */
  recommended_decision: CounterfactualGateDecision,
  /** 0-1 — brain's estimate of P(assumption is wrong). */
  probability_wrong: z.number().min(0).max(1),
});
type LlmCritique = z.infer<typeof LlmCritiqueSchema>;

// ─────────────────────────────────────────────────────────────────────
// Output — the counterfactualRisk signal for the autonomy-controller
// ─────────────────────────────────────────────────────────────────────

export const CounterfactualRiskSignal = z.object({
  action_id: z.string().min(1),
  origin_junior: z.string().min(1),
  /** Coarse band for ranking / dashboards. */
  band: CounterfactualRiskBand,
  /** Continuous 0-1 score (0 = safe, 1 = maximally risky-if-wrong). */
  risk_score: z.number().min(0).max(1),
  /** The composed gate decision the autonomy-controller MUST honour. */
  gate_decision: CounterfactualGateDecision,
  /**
   * True when the deterministic floor escalated regardless of the LLM.
   * The autonomy-controller treats this as non-overridable by trust.
   */
  deterministic_escalation: z.boolean(),
  /** Short natural-language counterfactual the owner sees on escalation. */
  counterfactual: z.string().min(1),
  /** Plain-language downside-if-wrong summary. */
  downside_if_wrong: z.string().min(1),
  /** Whether the gate judged the action recoverable. */
  recoverable: z.boolean(),
  /** Evidence chain the action rests on (echoed for the audit trail). */
  evidence_ids: z.array(z.string()).default([]),
  /** Why the gate landed where it did. */
  rationale: z.string().min(1),
});
export type CounterfactualRiskSignal = z.infer<typeof CounterfactualRiskSignal>;

// ─────────────────────────────────────────────────────────────────────
// Deterministic floor — authoritative for the irreversible × high corner
// ─────────────────────────────────────────────────────────────────────

/**
 * The non-negotiable floor. Runs BEFORE the brain and is authoritative:
 * an irreversible action with high/severe downside ALWAYS escalates,
 * regardless of what the LLM (or trust track-record) says. This is the
 * additive-gating guarantee — the gate can only raise the floor.
 *
 * Pure: no I/O, no clock, no mutation.
 */
export function deterministicFloor(
  input: CounterfactualCheckInput,
): CounterfactualGateDecision {
  // Empty evidence on a high-consequence action ⇒ acting blind ⇒ escalate.
  if (input.evidence_ids.length === 0) return 'escalate';

  const sev = SEVERITY_RANK[input.downside_severity];
  const highOrWorse = sev >= SEVERITY_RANK.high;
  const isSevere = sev >= SEVERITY_RANK.severe;

  // Irreversible × (high|severe) downside ⇒ ALWAYS escalate.
  if (input.reversibility === 'irreversible' && highOrWorse) return 'escalate';

  // Irreversible × any downside with low calibrated confidence ⇒ escalate
  // (the assumption is shaky AND the cost of being wrong cannot be undone).
  if (input.reversibility === 'irreversible' && input.confidence < 0.6) {
    return 'escalate';
  }

  // Reversible-with-cost × severe downside ⇒ escalate.
  if (input.reversibility === 'reversible-with-cost' && isSevere) {
    return 'escalate';
  }

  // Reversible-with-cost × high (not severe) downside ⇒ revise (re-ground first).
  if (input.reversibility === 'reversible-with-cost' && highOrWorse) {
    return 'revise';
  }

  // Fully reversible, or low/moderate downside ⇒ floor allows proceed;
  // the brain critique may still raise it.
  return 'proceed';
}

/**
 * Continuous risk score in [0,1] combining reversibility, downside
 * severity, the (in)confidence, and the brain's P(wrong). Pure.
 */
export function computeRiskScore(
  input: CounterfactualCheckInput,
  probabilityWrong: number,
): number {
  const reversibilityWeight =
    input.reversibility === 'irreversible'
      ? 1
      : input.reversibility === 'reversible-with-cost'
        ? 0.6
        : 0.25;
  const severityWeight = (SEVERITY_RANK[input.downside_severity] + 1) / 4; // 0.25..1
  // P(wrong) blends the brain's estimate with (1 - calibrated confidence).
  const pWrong = clamp01((probabilityWrong + (1 - input.confidence)) / 2);
  // Consequence = how bad × how likely-undoable-it-is-not.
  const consequence = reversibilityWeight * severityWeight;
  return clamp01(consequence * (0.5 + 0.5 * pWrong));
}

function bandFromScore(score: number): CounterfactualRiskBand {
  if (score >= 0.66) return 'high';
  if (score >= 0.33) return 'medium';
  return 'low';
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 1; // fail-closed: unknown ⇒ max risk
  return Math.max(0, Math.min(1, n));
}

// ─────────────────────────────────────────────────────────────────────
// Prompt
// ─────────────────────────────────────────────────────────────────────

export const COUNTERFACTUAL_SELF_CHECK_SYSTEM_PROMPT = buildUniversalPrompt({
  juniorName: 'Counterfactual Self-Check Gate',
  mandate:
    'Before a high-consequence autonomous action commits, critique your OWN reasoning: ' +
    'negate the single key assumption / evidence_id the action rests on and reason about ' +
    'the downside if it is wrong and whether the consequence is reversible. ' +
    'Recommend proceed (downside low or reversible), revise (re-ground first), or escalate ' +
    '(downside high AND irreversible — force human gating even in an auto flow). ' +
    'Be adversarial toward your own confidence; an overconfident wrong irreversible act is the worst outcome.',
  tools:
    'negate_assumption(assumption) -> counterfactual_scenario ; ' +
    'assess_downside(scenario) -> { downside, recoverable } ; ' +
    'estimate_probability_wrong(evidence_ids, assumption) -> p.',
  evidence:
    'Cite the evidence_id whose falsity would cause the largest downside. ' +
    'If evidence_ids is empty, recommend escalate — there is nothing to verify against.',
  outputSchema:
    '{ "counterfactual": string, "downside_if_wrong": string, "recoverable": boolean, ' +
    '"recommended_decision": "proceed"|"revise"|"escalate", "probability_wrong": number }',
  confidenceFloor: 0.7,
  autonomyDomain: 'self-gating-only — never executes; can only ADD gating, never remove it',
  hardRules: [
    'NEVER recommend proceed for an irreversible action with high/severe downside.',
    'NEVER downgrade a rail-gated action to auto — this gate can only escalate.',
    'If evidence_ids is empty, recommend escalate.',
    'Reason about the consequence of being WRONG, not the expected (right) case.',
  ],
});

function buildUserPrompt(input: CounterfactualCheckInput): string {
  return [
    `TENANT: ${input.tenantId}`,
    `ORIGIN JUNIOR: ${input.origin_junior}`,
    `PROPOSED ACTION: ${input.action_summary}`,
    `KEY ASSUMPTION (negate this): ${input.key_assumption}`,
    `EVIDENCE_IDS: ${JSON.stringify(input.evidence_ids)}`,
    `REVERSIBILITY: ${input.reversibility}`,
    `DOWNSIDE SEVERITY (if assumption wrong): ${input.downside_severity}`,
    `CALIBRATED CONFIDENCE IN ASSUMPTION: ${input.confidence.toFixed(2)}`,
    `FLOW POSTURE (absent this gate): ${input.flow_posture}`,
    ``,
    `Generate the counterfactual: "If '${input.key_assumption}' is WRONG, what happens?"`,
  ].join('\n');
}

// ─────────────────────────────────────────────────────────────────────
// Brain critique (via the injected ClaudeClient port — no SDK)
// ─────────────────────────────────────────────────────────────────────

/**
 * Calls the brain port for the counterfactual critique. Fail-closed: any
 * error / malformed response yields a maximally-cautious critique
 * (recommend escalate, P(wrong)=1) so the deterministic floor and the
 * composition step never let a brain outage open the gate.
 */
async function runBrainCritique(
  claude: ClaudeClient,
  input: CounterfactualCheckInput,
  logger?: JuniorLogger,
): Promise<{ critique: LlmCritique; brainAvailable: boolean }> {
  try {
    const response = await claude.complete({
      systemPrompt: COUNTERFACTUAL_SELF_CHECK_SYSTEM_PROMPT,
      userPrompt: buildUserPrompt(input),
      model: resolveTierModelId('cheap'),
      maxTokens: 700,
      temperature: 0,
    });
    const parsed = parseClaudeJson(response.content);
    if (!parsed.ok) {
      logger?.warn('counterfactual-self-check: malformed JSON from brain', {
        raw: response.content.slice(0, 256),
      });
      return { critique: failClosedCritique(input), brainAvailable: false };
    }
    const validated = LlmCritiqueSchema.safeParse(parsed.value);
    if (!validated.success) {
      logger?.warn('counterfactual-self-check: schema validation failed', {
        issues: validated.error.issues,
      });
      return { critique: failClosedCritique(input), brainAvailable: false };
    }
    return { critique: validated.data, brainAvailable: true };
  } catch (error) {
    logger?.warn('counterfactual-self-check: brain unavailable', {
      error: error instanceof Error ? error.message : String(error),
    });
    return { critique: failClosedCritique(input), brainAvailable: false };
  }
}

function failClosedCritique(input: CounterfactualCheckInput): LlmCritique {
  return {
    counterfactual: `Unable to reason about "${input.key_assumption}" being wrong (brain unavailable).`,
    downside_if_wrong:
      'Downside unknown — treating as maximal because the self-check could not run.',
    recoverable: input.reversibility === 'reversible',
    recommended_decision: 'escalate',
    probability_wrong: 1,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────

export function createCounterfactualSelfCheck(deps: JuniorDeps) {
  return {
    /**
     * Run the counterfactual self-check on a proposed high-consequence
     * action and emit the `counterfactualRisk` signal. The composed
     * `gate_decision` is the STRONGER of the deterministic floor and the
     * brain's recommendation — gating only ever increases.
     */
    async check(rawInput: CounterfactualCheckInput): Promise<CounterfactualRiskSignal> {
      const input = CounterfactualCheckInput.parse(rawInput);

      // 1. Deterministic floor — authoritative for the worst corner.
      const floor = deterministicFloor(input);

      // 2. Brain counterfactual critique (fail-closed).
      const { critique } = await runBrainCritique(deps.claude, input, deps.logger);

      // 3. Compose — the gate decision is max(floor, brain). The brain can
      //    RAISE the gate (escalate a proceed) but never LOWER it below the
      //    deterministic floor.
      const gateDecision = maxGateDecision(floor, critique.recommended_decision);

      // 4. Risk score + band.
      const riskScore = computeRiskScore(input, critique.probability_wrong);
      const band = bandFromScore(riskScore);

      const deterministicEscalation = floor === 'escalate';
      const recoverable =
        input.reversibility === 'reversible' ? true : critique.recoverable && !deterministicEscalation;

      const rationale = buildRationale(input, floor, critique, gateDecision);

      return CounterfactualRiskSignal.parse({
        action_id: input.action_id,
        origin_junior: input.origin_junior,
        band,
        risk_score: riskScore,
        gate_decision: gateDecision,
        deterministic_escalation: deterministicEscalation,
        counterfactual: critique.counterfactual,
        downside_if_wrong: critique.downside_if_wrong,
        recoverable,
        evidence_ids: [...input.evidence_ids],
        rationale,
      });
    },
  };
}
export type CounterfactualSelfCheck = ReturnType<typeof createCounterfactualSelfCheck>;

function buildRationale(
  input: CounterfactualCheckInput,
  floor: CounterfactualGateDecision,
  critique: LlmCritique,
  composed: CounterfactualGateDecision,
): string {
  const parts: string[] = [];
  if (floor === 'escalate') {
    parts.push(
      input.evidence_ids.length === 0
        ? 'Deterministic floor: empty evidence chain on a high-consequence action — acting blind.'
        : `Deterministic floor: ${input.reversibility} action with ${input.downside_severity} downside (confidence ${input.confidence.toFixed(2)}).`,
    );
  } else if (floor === 'revise') {
    parts.push(
      `Deterministic floor: ${input.reversibility} action with ${input.downside_severity} downside — re-ground before acting.`,
    );
  }
  if (critique.recommended_decision === 'escalate' && floor !== 'escalate') {
    parts.push(`Brain critique escalated: ${critique.downside_if_wrong}`);
  } else if (critique.recommended_decision === 'revise' && floor === 'proceed') {
    parts.push(`Brain critique flagged revise: ${critique.downside_if_wrong}`);
  }
  if (composed === 'proceed') {
    parts.push('Downside-if-wrong is low or fully reversible; auto flow may proceed.');
  } else if (composed === 'escalate') {
    parts.push('Forcing human gating EVEN in an auto flow (additive — rail gates still apply).');
  }
  return parts.join(' ');
}

// ─────────────────────────────────────────────────────────────────────
// Lazy default (reads ANTHROPIC_API_KEY on first call, like peers)
// ─────────────────────────────────────────────────────────────────────

export function createDefaultCounterfactualSelfCheck(): CounterfactualSelfCheck {
  let cached: CounterfactualSelfCheck | null = null;
  const get = async (): Promise<CounterfactualSelfCheck> => {
    if (cached) return cached;
    const deps = await withResolvedDb(defaultJuniorDeps());
    cached = createCounterfactualSelfCheck(deps);
    return cached;
  };
  return {
    async check(input) {
      return (await get()).check(input);
    },
  };
}
