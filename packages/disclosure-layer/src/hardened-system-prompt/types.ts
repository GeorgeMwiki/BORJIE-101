/**
 * Hardened-system-prompt types.
 *
 * Source: .research/r-ip-disclosure-capability-explanation-frontier.md §4
 *
 * Two SP variants:
 *   - external — for tenant-customer / property-owner (Tier-1 SAFE only)
 *   - internal — for internal-cs-agent / platform-admin / engineer
 *     (adds Tier-2 disclosure clauses; still NEVER reveals Tier-3)
 */

import type { CanaryToken } from '../canary-tokens/types.js';

/**
 * Variant of the system prompt to render.
 */
export type SystemPromptVariant = 'external' | 'internal';

/**
 * Input to `composeHardenedSystemPrompt`.
 */
export interface ComposeSystemPromptInput {
  readonly variant: SystemPromptVariant;
  readonly canary: CanaryToken;
  /** Optional jurisdiction (defaults to 'TZ'); affects supported-juris clause. */
  readonly jurisdiction?: string;
  /** Optional knowledge cutoff (defaults to 'January 2026'). */
  readonly knowledgeCutoff?: string;
  /** Optional extra refusal section text (appended below CLOSE template). */
  readonly extraRefusalSection?: string;
}

/**
 * Composed system prompt output.
 */
export interface ComposedSystemPrompt {
  readonly variant: SystemPromptVariant;
  readonly text: string;
  readonly canaryValue: string;
  readonly hasIdentityAsAI: boolean;
  readonly hasRefusalSection: boolean;
  readonly hasCloseTemplate: boolean;
}
