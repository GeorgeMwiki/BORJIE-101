/**
 * Runtime-defense-composer — chain the 9 N-D modules into one pipeline.
 *
 * Source: .research/r-ip-disclosure-capability-explanation-frontier.md §4 + §6
 */

export {
  type DefendedRespondInput,
  type DefendedResponse,
  type DraftIntentHints,
  type DraftResponse,
} from './types.js';
export { defendedRespond } from './composer.js';
