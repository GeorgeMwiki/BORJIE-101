/**
 * CLOSE-pattern refusal grammar.
 *
 * Source: .research/r-ip-disclosure-capability-explanation-frontier.md §3
 */

export {
  type CloseRefusalCategory,
  type CloseRefusalInput,
  type RefusalCard,
} from './types.js';
export { closeRefusal, closeRefusalForCategory } from './close-refusal.js';
export { getPrebuiltRefusal, listPrebuiltCategories } from './prebuilt.js';
