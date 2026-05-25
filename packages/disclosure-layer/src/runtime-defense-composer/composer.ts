/**
 * `defendedRespond` — runtime defense composer.
 *
 * Source: .research/r-ip-disclosure-capability-explanation-frontier.md §4 + §6
 *
 * Composes all 9 N-D modules in order. Pure orchestrator: each step
 * either short-circuits (refusal) or annotates the response.
 */

import { detectCanaryLeak } from '../canary-tokens/detector.js';
import {
  type CloseRefusalCategory,
  closeRefusalForCategory,
} from '../close-pattern/index.js';
import {
  type DisclosureAuditEvent,
  buildDisclosureEvent,
} from '../disclosure-audit/index.js';
import { getMandatoryDisclosure } from '../eu-ai-act-art-50/index.js';
import { getDisclosureTierForPrincipal } from '../role-gate/role-gate.js';
import { spotlightDisclosedField } from '../spotlighting/spotlight.js';
import { discloseField } from '../tier-taxonomy/disclose-field.js';
import { type CapabilityField, DisclosureTier } from '../tier-taxonomy/types.js';
import {
  type DefendedRespondInput,
  type DefendedResponse,
  type DraftResponse,
} from './types.js';

/** Filter the draft's fields by the principal's tier. */
function filterDraftFields(
  draft: DraftResponse,
  tier: DisclosureTier
): {
  readonly disclosed: Partial<Record<CapabilityField, string>>;
  readonly refused: ReadonlyArray<CapabilityField>;
} {
  if (draft.fields === undefined) {
    return { disclosed: {}, refused: Object.freeze([]) };
  }
  const disclosed: Partial<Record<CapabilityField, string>> = {};
  const refused: CapabilityField[] = [];
  for (const key of Object.keys(draft.fields) as CapabilityField[]) {
    if (discloseField(key, tier)) {
      disclosed[key] = draft.fields[key];
    } else {
      refused.push(key);
    }
  }
  return { disclosed, refused: Object.freeze([...refused]) };
}

/** Map intent hints + attempted-field tier to a refusal category. */
function determineRefusalCategory(
  input: DefendedRespondInput
): CloseRefusalCategory | undefined {
  if (input.hints?.isSystemPromptProbe === true) return 'system-prompt-leak';
  if (input.hints?.attemptedFields !== undefined) {
    for (const f of input.hints.attemptedFields) {
      if (f === 'systemPromptText') return 'system-prompt-leak';
    }
  }
  return undefined;
}

/**
 * Build the final user-facing text. Order:
 *   1. EU AI Act Art 50 prelude (first interaction only)
 *   2. Refusal card OR draft text + spotlit disclosed fields
 */
function composeFinalText(
  input: DefendedRespondInput,
  refusal: ReturnType<typeof closeRefusalForCategory> | undefined,
  disclosed: Partial<Record<CapabilityField, string>>
): { readonly text: string; readonly euEmitted: boolean } {
  const lines: string[] = [];
  const prelude = getMandatoryDisclosure({
    surface: input.surface,
    isFirstInteraction: input.isFirstInteraction,
  });
  if (prelude.emit) {
    lines.push(prelude.text);
    lines.push('');
  }
  if (refusal !== undefined) {
    lines.push(refusal.text);
  } else {
    lines.push(input.draftResponse.text);
    const fieldKeys = Object.keys(disclosed) as CapabilityField[];
    if (fieldKeys.length > 0) {
      lines.push('');
      for (const key of fieldKeys) {
        const content = disclosed[key] ?? '';
        if (content.length > 0) {
          const wrapped = spotlightDisclosedField(content);
          lines.push(`[disclosed:${key}]`);
          lines.push(wrapped.wrapped);
        }
      }
    }
  }
  return { text: lines.join('\n'), euEmitted: prelude.emit };
}

/**
 * Main composer.
 */
export async function defendedRespond(input: DefendedRespondInput): Promise<DefendedResponse> {
  const now = input.now ?? Date.now();

  // Step 1: detect canary leak
  const canaryScan = detectCanaryLeak(input.draftResponse.text, input.canary);

  // Step 2: resolve principal tier
  const principalTier = getDisclosureTierForPrincipal(input.principal);

  // Step 3: determine if a CLOSE refusal is required
  // Refusal triggers:
  //   (a) canary leak detected → system-prompt-leak refusal
  //   (b) intent hint says system-prompt probe → system-prompt-leak
  //   (c) ANY Tier-3 field requested by an external principal → system-prompt-leak
  //   (d) Tier-2 field requested by a SAFE principal (e.g. "what's the LLM behind you?"
  //       from a tenant-customer) → system-prompt-leak
  let refusalCategory: CloseRefusalCategory | undefined = determineRefusalCategory(input);
  if (canaryScan.leaked && refusalCategory === undefined) {
    refusalCategory = 'system-prompt-leak';
  }
  if (refusalCategory === undefined && input.hints?.attemptedFields !== undefined) {
    for (const f of input.hints.attemptedFields) {
      if (!discloseField(f, principalTier)) {
        refusalCategory = 'system-prompt-leak';
        break;
      }
    }
  }

  // Step 4: filter draft fields
  const { disclosed, refused } = filterDraftFields(input.draftResponse, principalTier);

  // Step 5: build refusal card if needed
  const refusalCard = refusalCategory !== undefined ? closeRefusalForCategory(refusalCategory) : undefined;

  // Step 6: assemble final text (with optional EU AI Act prelude)
  const { text, euEmitted } = composeFinalText(input, refusalCard, disclosed);

  // Step 7: build audit event
  const fieldsReturned = Object.freeze(Object.keys(disclosed) as CapabilityField[]);
  const refusedFields: ReadonlyArray<CapabilityField> = refusalCard !== undefined
    ? Object.freeze([...(input.hints?.attemptedFields ?? []), ...refused])
    : refused;

  const auditEvent: DisclosureAuditEvent = buildDisclosureEvent(
    {
      principalId: input.principal.id,
      principalRole: input.principal.role,
      principalTier,
      query: input.query,
      fieldsReturned,
      refusedFields,
      ...(refusalCategory !== undefined ? { refusalCategory } : {}),
      canaryLeakDetected: canaryScan.leaked,
      ...(euEmitted ? { euAct50EmittedSurface: input.surface } : {}),
    },
    now
  );
  await input.auditSink.log(auditEvent);

  return Object.freeze({
    text,
    principalTier,
    refused: refusalCard !== undefined,
    ...(refusalCategory !== undefined ? { refusalCategory } : {}),
    ...(refusalCard !== undefined ? { refusalCard } : {}),
    fieldsReturned,
    refusedFields,
    canaryLeakDetected: canaryScan.leaked,
    ...(euEmitted ? { euAct50EmittedSurface: input.surface } : {}),
    auditEvent,
  });
}
