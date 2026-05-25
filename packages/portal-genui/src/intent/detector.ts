/**
 * Intent detector — the public entry point for "is the user asking
 * for a new tab?".
 *
 * Pipeline:
 *   1. Heuristic classifier (no network). When confident, return.
 *   2. Optional LLM escalator. When heuristic is ambiguous, fan out
 *      to the multi-LLM synthesizer (or a single sensor when no
 *      synthesizer is wired) for a more nuanced verdict.
 *   3. Cross-check against existing tabs — if the proposed tab key
 *      already exists, downgrade confidence and flip the LLM-used
 *      flag so the caller can present an "extend existing tab"
 *      alternative.
 *
 * The detector is pure with respect to its inputs — it never reads
 * env vars or persistent state. Composition root wires the brain
 * port, the existing-tab list, and the cache.
 */

import {
  TabGenerationIntentSchema,
  type TabGenerationIntent,
  type PortalTab,
} from '../types.js';
import { classifyHeuristic } from './heuristics.js';

// ────────────────────────────────────────────────────────────────────
// Brain port — narrow shape the detector consumes. Keep it minimal so
// the composition root can satisfy it with either the multi-LLM
// synthesizer or a single sensor adapter.
// ────────────────────────────────────────────────────────────────────

export interface BrainClassifyCall {
  readonly system: string;
  readonly userMessage: string;
}

export interface BrainClassifyResult {
  readonly text: string;
}

export interface BrainPort {
  classify(call: BrainClassifyCall): Promise<BrainClassifyResult>;
}

// ────────────────────────────────────────────────────────────────────
// Detector inputs / outputs
// ────────────────────────────────────────────────────────────────────

export interface DetectTabIntentInput {
  /** The user message — usually the latest turn in the chat. */
  readonly message: string;
  /**
   * Existing tab keys the user already has. Used to suppress
   * duplicate-intent classifications and surface "extend" suggestions
   * upstream.
   */
  readonly currentTabKeys?: ReadonlyArray<string>;
  /**
   * Optional role-bias — when the user is acting as `customer`, we
   * suppress generation for ops/eng/legal domains they shouldn't be
   * scaffolding. Pass undefined to skip the bias.
   */
  readonly role?:
    | 'internal_admin'
    | 'property_manager'
    | 'estate_manager'
    | 'owner'
    | 'customer';
}

export interface DetectorDeps {
  /** Brain port for LLM escalation. Optional — falls back to heuristic only. */
  readonly brain?: BrainPort;
  /**
   * Override the heuristic-confidence band that triggers an LLM call.
   * Defaults to `[0.05, 0.75]` — outside the band the heuristic is
   * trusted.
   */
  readonly escalateBand?: readonly [number, number];
}

const DEFAULT_ESCALATE_BAND: readonly [number, number] = [0.05, 0.75];

const CLASSIFIER_SYSTEM_PROMPT = `You classify property-management-portal user messages for tab-generation intent.

Return ONE LINE of strict JSON with the shape:
  {"intent": true|false,
   "tabKey": "<lowercased.dot.separated.key | empty when false>",
   "tabTitle": "<short title | empty when false>",
   "domain": "<hr|finance|compliance|procurement|operations|sales|marketing|engineering|legal|sustainability|custom>",
   "evidence": ["<phrase>", "..."],
   "confidence": <0..1>}

INTENT = TRUE only when the user is asking for a NEW area / section /
tab / module to track or manage something the existing portal does not
already cover.

INTENT = FALSE when the user is asking a question about EXISTING data,
chatting socially, complaining about a bug, or requesting a one-off
report.

Examples:
  "we need to track our staff payroll" -> intent=true, domain=hr
  "what's the rent due this month?"    -> intent=false
  "please add a supplier onboarding tab" -> intent=true, domain=procurement
  "the dashboard is slow today"         -> intent=false
  "I want a place to put our ISO 27001 evidence" -> intent=true, domain=compliance

RESPOND WITH JSON ONLY. NO PROSE.`;

/** Restrict-by-role — keep customers from scaffolding ops tabs. */
function isDomainAllowedForRole(
  domain: TabGenerationIntent['domain'],
  role: DetectTabIntentInput['role'],
): boolean {
  if (!role) return true;
  if (role === 'customer') {
    return domain === 'finance' || domain === 'sustainability';
  }
  if (role === 'owner') {
    return (
      domain === 'finance' ||
      domain === 'compliance' ||
      domain === 'sustainability' ||
      domain === 'operations' ||
      domain === 'custom'
    );
  }
  return true;
}

/** Parse + validate a brain JSON response into a `TabGenerationIntent`. */
function tryParseBrainJson(
  raw: string,
  sourceMessage: string,
): TabGenerationIntent | null {
  // The brain might wrap the JSON in ``` fences or prose. Pull the
  // first {...} block.
  const block = raw.match(/\{[\s\S]*\}/);
  if (!block) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(block[0]);
  } catch {
    return null;
  }
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    !('intent' in parsed) ||
    (parsed as { intent: unknown }).intent !== true
  ) {
    return null;
  }
  const obj = parsed as Record<string, unknown>;
  const candidate = {
    proposedTabKey: typeof obj.tabKey === 'string' ? obj.tabKey : '',
    proposedTabTitle:
      typeof obj.tabTitle === 'string' && obj.tabTitle.length > 0
        ? obj.tabTitle
        : 'New Tab',
    domain:
      typeof obj.domain === 'string' &&
      [
        'hr',
        'finance',
        'compliance',
        'procurement',
        'operations',
        'sales',
        'marketing',
        'engineering',
        'legal',
        'sustainability',
        'custom',
      ].includes(obj.domain)
        ? (obj.domain as TabGenerationIntent['domain'])
        : 'custom',
    confidence:
      typeof obj.confidence === 'number' &&
      obj.confidence >= 0 &&
      obj.confidence <= 1
        ? obj.confidence
        : 0.6,
    evidence: Array.isArray(obj.evidence)
      ? (obj.evidence as unknown[])
          .filter((s): s is string => typeof s === 'string')
          .slice(0, 10)
      : [],
    sourceMessage: sourceMessage.slice(0, 2048),
    usedLlm: true,
  };
  const validated = TabGenerationIntentSchema.safeParse(candidate);
  return validated.success ? validated.data : null;
}

/**
 * Main entry point. Returns `null` when no intent is detected — the
 * caller can then ignore the message safely.
 */
export async function detectTabGenerationIntent(
  input: DetectTabIntentInput,
  deps: DetectorDeps = {},
): Promise<TabGenerationIntent | null> {
  if (typeof input.message !== 'string' || input.message.trim().length === 0) {
    return null;
  }

  const heuristic = classifyHeuristic(input.message);
  const band = deps.escalateBand ?? DEFAULT_ESCALATE_BAND;
  const heuristicHigh = heuristic.heuristicConfidence >= band[1];
  const heuristicLow = heuristic.heuristicConfidence <= band[0];

  // Cheap path — accept or reject without LLM.
  if (heuristicHigh && heuristic.classified) {
    return applyExistingTabCheck(heuristic.classified, input);
  }
  if (heuristicLow) {
    return null;
  }

  // Escalate when a brain is wired and the heuristic is ambiguous.
  if (!deps.brain) {
    // No brain wired — fall back to whatever the heuristic produced
    // (may be null when intent was present but domain was missing).
    return heuristic.classified
      ? applyExistingTabCheck(heuristic.classified, input)
      : null;
  }

  try {
    const result = await deps.brain.classify({
      system: CLASSIFIER_SYSTEM_PROMPT,
      userMessage: input.message.slice(0, 2048),
    });
    const llmIntent = tryParseBrainJson(result.text, input.message);
    if (llmIntent && isDomainAllowedForRole(llmIntent.domain, input.role)) {
      return applyExistingTabCheck(llmIntent, input);
    }
  } catch {
    // Brain failed → fall back to the heuristic.
  }

  return heuristic.classified
    ? applyExistingTabCheck(heuristic.classified, input)
    : null;
}

/**
 * If the proposed tab key already exists, downgrade confidence to
 * surface the conflict upstream. We don't suppress entirely — the
 * UI layer should offer "edit existing" vs "create new".
 */
function applyExistingTabCheck(
  intent: TabGenerationIntent,
  input: DetectTabIntentInput,
): TabGenerationIntent {
  if (!isDomainAllowedForRole(intent.domain, input.role)) {
    return {
      ...intent,
      confidence: Math.min(intent.confidence, 0.1),
    };
  }
  if (
    input.currentTabKeys &&
    input.currentTabKeys.includes(intent.proposedTabKey)
  ) {
    return {
      ...intent,
      confidence: Math.min(intent.confidence, 0.3),
      evidence: [
        ...intent.evidence,
        `tab_key_exists:${intent.proposedTabKey}`,
      ].slice(0, 10),
    };
  }
  return intent;
}

/**
 * Predicate convenience — wrap `detectTabGenerationIntent` and
 * return only `true|false`. Useful for chat-loop hooks that only
 * need the decision.
 */
export async function hasTabGenerationIntent(
  input: DetectTabIntentInput,
  deps: DetectorDeps = {},
  minConfidence = 0.5,
): Promise<boolean> {
  const intent = await detectTabGenerationIntent(input, deps);
  return intent !== null && intent.confidence >= minConfidence;
}

/** Re-export for callers that only need the type. */
export type { PortalTab };
