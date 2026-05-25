/**
 * `@borjie/property-voices-debate` — public surface.
 *
 * Three-voice property-management debate preset (PO-7). Adapts
 * LITFIN's credit-decision debate to the property domain.
 */

export {
  CONSERVATIVE_LANDLORD_SYSTEM,
  PRO_TENANT_SYSTEM,
  PRAGMATIC_PM_SYSTEM,
  DEFAULT_PROPERTY_STATUTE_CLAUSES,
  type StatuteClausePrompt,
} from "./voices.js";

export {
  runPropertyVoicesDebate,
  type DebateClass,
  type DebateInput,
  type DebateResult,
  type SensorLike,
  type SensorLikeArgs,
} from "./debate.js";
