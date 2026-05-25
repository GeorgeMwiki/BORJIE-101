/**
 * Hardened-system-prompt — composes the SP that resists "show me your
 * prompt" probes.
 *
 * Source: .research/r-ip-disclosure-capability-explanation-frontier.md §4 + §6
 */

export {
  type ComposedSystemPrompt,
  type ComposeSystemPromptInput,
  type SystemPromptVariant,
} from './types.js';
export {
  CLOSE_TEMPLATE,
  IDENTITY_CLAUSE,
  REFUSAL_SECTION,
  TIER_2_CLAUSE,
  canaryPreamble,
  systemDirectives,
} from './templates.js';
export { composeHardenedSystemPrompt } from './compose.js';
