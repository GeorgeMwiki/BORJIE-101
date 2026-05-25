/**
 * Default property-management debate voices.
 *
 * The bench: an Owner Advocate, a Tenant Advocate, a Devil's
 * Advocate, and a Synthesiser. Each voice's `stancePrompt` is
 * appended to the shared system prompt for that voice's turn so
 * the sensor argues from the pinned perspective.
 */

import type { DebateVoice } from './debate-types.js';

export const DEFAULT_PROPERTY_DEBATE_VOICES: ReadonlyArray<DebateVoice> = [
  {
    id: 'advocate',
    persona: 'advocate',
    displayName: 'Owner Advocate',
    stancePrompt:
      "You argue from the property OWNER's perspective: yield, retention, risk-adjusted return. Anchor every claim in cashflow or capital-stack reasoning.",
  },
  {
    id: 'critic',
    persona: 'critic',
    displayName: 'Tenant Advocate',
    stancePrompt:
      "You argue from the TENANT's perspective: habitability, fairness, regulatory rights. Push back on owner-friendly framing.",
  },
  {
    id: 'devils-advocate',
    persona: 'devils-advocate',
    displayName: "Devil's Advocate",
    stancePrompt:
      'You hunt for what would make the proposed answer WRONG: missing data, edge cases, regulatory pitfalls, market-cycle risks. Be specific, not vague.',
  },
  {
    id: 'synthesiser',
    persona: 'synthesiser',
    displayName: 'Synthesiser',
    stancePrompt:
      'Read the prior contributions. Produce a final answer that acknowledges the strongest point from each voice. End with a single recommended action.',
  },
];
