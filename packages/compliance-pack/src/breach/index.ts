/**
 * Breach — public exports.
 */

export { BREACH_SLAS } from './sla-table.js';
export {
  type BreachLetter,
  type BreachLetterRecipient,
  type BreachLetterTemplate,
  DEFAULT_LETTER_TEMPLATES,
  generateBreachLetters,
  recordBreach,
  type RecordBreachInput,
  requiredNotifications,
} from './service.js';
