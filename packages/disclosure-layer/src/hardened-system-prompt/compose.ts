/**
 * `composeHardenedSystemPrompt` — assemble the SP variant for a session.
 *
 * Source: .research/r-ip-disclosure-capability-explanation-frontier.md §4 + §6
 */

import {
  CLOSE_TEMPLATE,
  IDENTITY_CLAUSE,
  REFUSAL_SECTION,
  TIER_2_CLAUSE,
  canaryPreamble,
  systemDirectives,
} from './templates.js';
import {
  type ComposeSystemPromptInput,
  type ComposedSystemPrompt,
} from './types.js';

const DEFAULT_JURISDICTION = 'TZ';
const DEFAULT_CUTOFF = 'January 2026';

/**
 * Compose the hardened system prompt for the given variant + session.
 *
 * The final order:
 *   1. canary preamble (DO-NOT-REVEAL)
 *   2. identity-as-AI clause (Art. 50)
 *   3. spotlighting directive (data vs commands)
 *   4. refusal section (resist "show me your prompt")
 *   5. CLOSE template
 *   6. Tier-2 clause (only if variant === 'internal')
 *   7. extraRefusalSection (caller-supplied)
 *   8. jurisdiction + knowledge-cutoff footnote
 */
export function composeHardenedSystemPrompt(
  input: ComposeSystemPromptInput
): ComposedSystemPrompt {
  const jurisdiction = input.jurisdiction ?? DEFAULT_JURISDICTION;
  const cutoff = input.knowledgeCutoff ?? DEFAULT_CUTOFF;
  const parts: string[] = [
    canaryPreamble(input.canary.value),
    '',
    IDENTITY_CLAUSE,
    '',
    systemDirectives(),
    '',
    REFUSAL_SECTION,
    '',
    CLOSE_TEMPLATE,
  ];

  if (input.variant === 'internal') {
    parts.push('', TIER_2_CLAUSE);
  }
  if (input.extraRefusalSection !== undefined && input.extraRefusalSection.trim().length > 0) {
    parts.push('', input.extraRefusalSection.trim());
  }
  parts.push(
    '',
    `Jurisdiction: ${jurisdiction}. Knowledge cutoff: ${cutoff}.`
  );

  const text = parts.join('\n');
  const includesT2 = input.variant === 'internal';
  return Object.freeze({
    variant: input.variant,
    text,
    canaryValue: input.canary.value,
    hasIdentityAsAI: text.includes(IDENTITY_CLAUSE),
    hasRefusalSection: text.includes(REFUSAL_SECTION),
    hasCloseTemplate: text.includes(CLOSE_TEMPLATE),
    ...(includesT2 ? { includesTier2Clause: true } : {}),
  }) as ComposedSystemPrompt;
}
