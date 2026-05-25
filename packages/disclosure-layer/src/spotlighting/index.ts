/**
 * Spotlighting — wrap retrieved content as DATA, not instructions.
 *
 * Source: .research/r-ip-disclosure-capability-explanation-frontier.md §4
 */

export {
  type SpotlightSource,
  type SpotlitContent,
  SPOTLIGHT_SYSTEM_DIRECTIVE,
} from './types.js';
export {
  spotlight,
  spotlightDisclosedField,
  spotlightTenantDocument,
  spotlightUserMessage,
  makeDelimiterId,
  getSpotlightSystemDirective,
  maxDelimiterRepetition,
} from './spotlight.js';
