/**
 * Uncertainty policy — step 11a of the kernel pipeline.
 *
 * A pure function over the existing `ConfidenceVector`. Given the
 * vector, the request stakes, and the kernel-rendered output text, the
 * policy decides whether to:
 *
 *   - `deliver`  → return the output as-is
 *   - `caveat`   → prepend a caveat block ("I'm uncertain about: …")
 *   - `ask-back` → force the reply into a clarifying-question shape
 *   - `escalate` → refuse and recommend a human path
 *
 * Thresholds (per spec):
 *   - overall < 0.40                          → caveat
 *   - overall < 0.25                          → ask-back
 *   - overall < 0.15 AND stakes ≥ 'high'      → escalate (refusal)
 *
 * The output text is property-management-tailored: caveats reference
 * the tenancy entities most likely to be at risk (rent, lease, owner
 * statement, maintenance ticket, valuation, KRA MRI withholding,
 * GePG control number, market-rate snapshot). The detector picks the
 * relevant entities by scanning the rendered output; the result is
 * deterministic and pure (no IO, no LLM).
 */

import type { ConfidenceVector, ThoughtRequest } from './kernel-types.js';

export type UncertaintyAction = 'deliver' | 'caveat' | 'ask-back' | 'escalate';

export interface UncertaintyDecision {
  readonly action: UncertaintyAction;
  /** Final text the caller should ship (with caveat / ask-back text
   *  applied). Empty when `action === 'escalate'`. */
  readonly text: string;
  /** Refusal reason code when `action === 'escalate'`; empty otherwise. */
  readonly escalationReason: '' | 'LOW_CONFIDENCE_HIGH_STAKES';
  /** The dominant weak component, for telemetry / decision-trace. */
  readonly weakestComponent:
    | 'groundedness'
    | 'stability'
    | 'review'
    | 'numericalConsistency';
  /** The property-management entity tags surfaced in the caveat. */
  readonly affectedEntities: ReadonlyArray<PropertyManagementEntity>;
}

export type PropertyManagementEntity =
  | 'rent'
  | 'lease'
  | 'owner-statement'
  | 'maintenance-ticket'
  | 'valuation'
  | 'kra-mri-withholding'
  | 'gepg-control-number'
  | 'market-rate-snapshot'
  | 'arrears'
  | 'occupancy';

export interface UncertaintyPolicyInput {
  readonly confidence: ConfidenceVector;
  readonly stakes: ThoughtRequest['stakes'];
  readonly outputText: string;
}

const CAVEAT_THRESHOLD = 0.4;
const ASK_BACK_THRESHOLD = 0.25;
const ESCALATE_THRESHOLD = 0.15;

/**
 * Entity detectors. Each entry is `[entity, matcher]`. The matcher is
 * a case-insensitive regex looking for the property-management term in
 * the rendered output. The set is intentionally small — we only flag
 * the entities the user is likely to act on, not every property-mgmt
 * noun.
 */
const ENTITY_DETECTORS: ReadonlyArray<readonly [PropertyManagementEntity, RegExp]> = [
  ['rent',                 /\b(rent|monthly rent|rent due|rental)\b/i],
  ['lease',                /\b(lease|tenancy agreement|lease term|renewal)\b/i],
  ['owner-statement',      /\b(owner statement|landlord statement|disbursement|payout)\b/i],
  ['maintenance-ticket',   /\b(maintenance|work order|repair ticket|ticket)\b/i],
  ['valuation',            /\b(valuation|appraisal|market value|estimated value)\b/i],
  ['kra-mri-withholding',  /\b(KRA|MRI|withholding|tax withhold|rental tax)\b/i],
  ['gepg-control-number',  /\b(GePG|control number|control no\.?)\b/i],
  ['market-rate-snapshot', /\b(market rate|comparable rent|comp rent|benchmark rent)\b/i],
  ['arrears',              /\b(arrears|overdue|delinquent|past due)\b/i],
  ['occupancy',            /\b(occupancy|vacancy|vacant unit|occupied)\b/i],
];

/**
 * Component → human-readable caveat-text snippet. Each snippet is a
 * complete clause that slots into the caveat header.
 */
const COMPONENT_CAVEAT_TEXT: Record<
  UncertaintyDecision['weakestComponent'],
  string
> = {
  groundedness:
    "I cited fewer sources than I'd want for this kind of question — treat my numbers as indicative until you check the source documents",
  stability:
    "I gave a different answer when I re-checked, which means this question is sensitive to small wording changes — please re-ask with one specific scenario",
  review:
    "an internal review pass scored this reply low — I may have missed a constraint or rule that applies here",
  numericalConsistency:
    "the numbers in my reply don't all match the tool outputs I had access to — re-verify any figure before you act on it",
};

export function resolveUncertaintyPolicy(
  input: UncertaintyPolicyInput,
): UncertaintyDecision {
  const overall = input.confidence.overall;
  const weakest = pickWeakestComponent(input.confidence);
  const stakes = input.stakes;
  const isHighStakes = stakes === 'high' || stakes === 'critical';

  // Escalate first (most aggressive action).
  if (overall < ESCALATE_THRESHOLD && isHighStakes) {
    return {
      action: 'escalate',
      text: '',
      escalationReason: 'LOW_CONFIDENCE_HIGH_STAKES',
      weakestComponent: weakest,
      affectedEntities: detectEntities(input.outputText),
    };
  }

  if (overall < ASK_BACK_THRESHOLD) {
    const askBack = renderAskBack(weakest, input.outputText);
    return {
      action: 'ask-back',
      text: askBack,
      escalationReason: '',
      weakestComponent: weakest,
      affectedEntities: detectEntities(input.outputText),
    };
  }

  if (overall < CAVEAT_THRESHOLD) {
    const entities = detectEntities(input.outputText);
    const caveat = renderCaveat(weakest, entities);
    return {
      action: 'caveat',
      text: `${caveat}\n\n${input.outputText}`,
      escalationReason: '',
      weakestComponent: weakest,
      affectedEntities: entities,
    };
  }

  return {
    action: 'deliver',
    text: input.outputText,
    escalationReason: '',
    weakestComponent: weakest,
    affectedEntities: detectEntities(input.outputText),
  };
}

function pickWeakestComponent(
  vector: ConfidenceVector,
): UncertaintyDecision['weakestComponent'] {
  const entries: ReadonlyArray<readonly [UncertaintyDecision['weakestComponent'], number]> = [
    ['groundedness', vector.groundedness],
    ['stability', vector.stability],
    ['review', vector.review],
    ['numericalConsistency', vector.numericalConsistency],
  ];
  // Lowest wins. Stable order on ties → first one in the list.
  let bestKey: UncertaintyDecision['weakestComponent'] = entries[0]![0];
  let bestVal = entries[0]![1];
  for (let i = 1; i < entries.length; i++) {
    const [k, v] = entries[i]!;
    if (v < bestVal) {
      bestVal = v;
      bestKey = k;
    }
  }
  return bestKey;
}

function detectEntities(text: string): ReadonlyArray<PropertyManagementEntity> {
  if (!text || !text.trim()) return [];
  const matches: Array<PropertyManagementEntity> = [];
  for (const [entity, re] of ENTITY_DETECTORS) {
    if (re.test(text)) matches.push(entity);
  }
  return matches;
}

const ENTITY_DISPLAY: Record<PropertyManagementEntity, string> = {
  'rent': 'rent figures',
  'lease': 'lease terms',
  'owner-statement': 'owner-statement disbursements',
  'maintenance-ticket': 'maintenance-ticket status',
  'valuation': 'valuation figures',
  'kra-mri-withholding': 'KRA MRI withholding rates',
  'gepg-control-number': 'GePG control-number references',
  'market-rate-snapshot': 'market-rate comparables',
  'arrears': 'arrears balances',
  'occupancy': 'occupancy / vacancy counts',
};

function renderCaveat(
  weakest: UncertaintyDecision['weakestComponent'],
  entities: ReadonlyArray<PropertyManagementEntity>,
): string {
  const why = COMPONENT_CAVEAT_TEXT[weakest];
  const lines: Array<string> = [`I'm uncertain about this answer — ${why}.`];
  if (entities.length > 0) {
    const list = entities.map((e) => ENTITY_DISPLAY[e]).join(', ');
    lines.push(`Affected: ${list}.`);
  }
  return lines.join(' ');
}

function renderAskBack(
  weakest: UncertaintyDecision['weakestComponent'],
  outputText: string,
): string {
  const entities = detectEntities(outputText);
  const focus = entities.length > 0
    ? ENTITY_DISPLAY[entities[0]!]
    : 'this request';
  const reason = COMPONENT_CAVEAT_TEXT[weakest];
  return [
    `Before I commit to this, can you confirm one thing about ${focus}? `,
    `I want to be careful here — ${reason}. `,
    `Specifically, can you tell me which unit / lease / period you're asking about, `,
    `and whether the figures should come from the current owner statement or the latest tool data?`,
  ].join('');
}
