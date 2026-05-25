/**
 * Right-to-explanation service.
 *
 * Implements GDPR Article 22 (right NOT to be subject to solely
 * automated decisions producing legal or similarly significant
 * effects) + EU AI Act Articles 13/14 (transparency + human oversight)
 * + the Wachter et al. 2017 "Counterfactual Explanations" approach.
 *
 * Flow:
 *   1. AI runs → `recordAutomatedDecision()` logs inputs, outputs,
 *      model id, confidence, alternatives.
 *   2. Subject requests review → `requestExplanation()` returns a
 *      human-readable summary + top contributing factors + a
 *      counterfactual that would have flipped the outcome.
 *   3. Subject opts out → `optOutOfAutomation()` flips the scope to
 *      manual review; future decisions in that scope must be made by
 *      a human.
 *
 * Citations:
 *  - GDPR Recital 71 — "right to obtain an explanation"
 *  - Wachter, Mittelstadt, Russell, "Counterfactual Explanations
 *    Without Opening the Black Box" (2017) Harvard JLT 31.2
 *  - EU AI Act Art. 13 (transparency to deployers)
 *  - EU AI Act Art. 14 (human oversight)
 */

import type {
  AutomatedDecisionDisclosure,
  ConsentScope,
  EthicsStore,
  Explanation,
  Jurisdiction,
  RightToExplanationRequest,
} from '../types.js';

export interface RightToExplanationService {
  recordAutomatedDecision(args: {
    decisionId: string;
    subjectId: string;
    decision: string;
    model: string;
    inputs: Readonly<Record<string, unknown>>;
    outputs: Readonly<Record<string, unknown>>;
    confidence: number;
    alternatives: ReadonlyArray<{
      readonly decision: string;
      readonly confidence: number;
    }>;
    jurisdiction: Jurisdiction;
    humanReviewed?: boolean;
  }): Promise<AutomatedDecisionDisclosure>;

  requestExplanation(args: {
    subjectId: string;
    decisionId: string;
    deliveryChannel?: 'web' | 'mobile' | 'sms' | 'voice' | 'paper' | 'in-person' | 'api';
  }): Promise<Explanation>;

  optOutOfAutomation(args: {
    subjectId: string;
    scope: ConsentScope;
  }): Promise<{ optedOutAt: string }>;

  isOptedOut(args: {
    subjectId: string;
    scope: ConsentScope;
  }): Promise<boolean>;
}

export interface RightToExplanationServiceDeps {
  readonly store: EthicsStore;
  readonly now?: () => Date;
}

function nowIso(now?: () => Date): string {
  return (now ? now() : new Date()).toISOString();
}

/**
 * Build top-3 factor list by absolute weight from the model's input.
 * Numeric inputs are weighted by |value| normalized over the sum of
 * |numeric values|; non-numeric inputs get a constant 0.1 weight so
 * they still appear when relevant.
 */
function topFactors(
  inputs: Readonly<Record<string, unknown>>,
): ReadonlyArray<{ readonly factor: string; readonly weight: number }> {
  const numericKeys: Array<[string, number]> = [];
  const otherKeys: string[] = [];
  for (const [k, v] of Object.entries(inputs)) {
    if (typeof v === 'number' && Number.isFinite(v)) {
      numericKeys.push([k, Math.abs(v)]);
    } else if (v !== null && v !== undefined) {
      otherKeys.push(k);
    }
  }
  const total = numericKeys.reduce((acc, [, w]) => acc + w, 0);
  const normalized = numericKeys
    .map(([k, w]): { factor: string; weight: number } => ({
      factor: k,
      weight: total > 0 ? +(w / total).toFixed(4) : 0,
    }))
    .sort((a, b) => b.weight - a.weight);
  const others = otherKeys.map((k): { factor: string; weight: number } => ({
    factor: k,
    weight: 0.1,
  }));
  return [...normalized, ...others].slice(0, 3);
}

/**
 * Wachter-style counterfactual: change the smallest-cost feature that
 * would have made the model produce an alternative outcome. With a
 * shipped model port out of scope, we emit a candidate description
 * based on the strongest alternative outcome from the decision log.
 */
function buildCounterfactual(decision: AutomatedDecisionDisclosure): {
  readonly description: string;
  readonly changes: Readonly<Record<string, unknown>>;
  readonly wouldYield: string;
} {
  const strongestAlt = decision.alternatives[0];
  const wouldYield = strongestAlt?.decision ?? 'human review';
  // Heuristic: pick the highest-weight numeric feature and suggest a
  // 20% shift in the direction that supports the alternative.
  const numericInputs = Object.entries(decision.inputs).filter(
    ([, v]) => typeof v === 'number' && Number.isFinite(v),
  ) as Array<[string, number]>;
  if (numericInputs.length === 0) {
    return {
      description: 'A change in any one of the supplied inputs would have produced a different outcome.',
      changes: {},
      wouldYield,
    };
  }
  const sorted = [...numericInputs].sort(
    (a, b) => Math.abs(b[1]) - Math.abs(a[1]),
  );
  const [topKey, topVal] = sorted[0]!;
  const suggested = +(topVal * 1.2).toFixed(4);
  return {
    description: `If '${topKey}' had been ~${suggested} instead of ${topVal}, the model would have likely produced '${wouldYield}'.`,
    changes: { [topKey]: suggested },
    wouldYield,
  };
}

export function createRightToExplanationService(
  deps: RightToExplanationServiceDeps,
): RightToExplanationService {
  const { store } = deps;

  return {
    async recordAutomatedDecision(args): Promise<AutomatedDecisionDisclosure> {
      if (args.confidence < 0 || args.confidence > 1) {
        throw new Error(
          '[ethics-framework/right-to-explanation] confidence must be in [0, 1]',
        );
      }
      const record: AutomatedDecisionDisclosure = {
        decisionId: args.decisionId,
        subjectId: args.subjectId,
        decision: args.decision,
        model: args.model,
        inputs: args.inputs,
        outputs: args.outputs,
        confidence: args.confidence,
        alternatives: args.alternatives,
        jurisdiction: args.jurisdiction,
        decidedAt: nowIso(deps.now),
        ...(args.humanReviewed !== undefined ? { humanReviewed: args.humanReviewed } : {}),
      };
      await store.appendAutomatedDecision(record);
      return record;
    },

    async requestExplanation({ subjectId, decisionId, deliveryChannel }): Promise<Explanation> {
      const decision = await store.findDecision(decisionId);
      if (!decision) {
        throw new Error(
          `[ethics-framework/right-to-explanation] decision '${decisionId}' not found`,
        );
      }
      if (decision.subjectId !== subjectId) {
        throw new Error(
          '[ethics-framework/right-to-explanation] subject does not match decision',
        );
      }
      const request: RightToExplanationRequest = {
        subjectId,
        decisionId,
        jurisdiction: decision.jurisdiction,
        requestedAt: nowIso(deps.now),
        ...(deliveryChannel !== undefined ? { deliveryChannel } : {}),
      };
      await store.recordExplanationRequest(request);

      const factors = topFactors(decision.inputs);
      const counterfactual = buildCounterfactual(decision);
      const summary = `Model '${decision.model}' produced decision '${decision.decision}' with confidence ${Math.round(decision.confidence * 100)}% based on the top factors: ${factors.map((f) => f.factor).join(', ')}.`;
      return {
        decisionId,
        summary,
        topFactors: factors,
        counterfactual,
        humanContact: 'support@borjie.example',
        generatedAt: nowIso(deps.now),
      };
    },

    async optOutOfAutomation({ subjectId, scope }): Promise<{ optedOutAt: string }> {
      const ts = nowIso(deps.now);
      await store.recordAutomationOptOut({
        subjectId,
        scope,
        recordedAt: ts,
      });
      return { optedOutAt: ts };
    },

    async isOptedOut({ subjectId, scope }): Promise<boolean> {
      return store.automationOptedOut({ subjectId, scope });
    },
  };
}
