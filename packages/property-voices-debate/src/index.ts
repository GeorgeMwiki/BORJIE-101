/**
 * `@borjie/property-voices-debate` — public surface.
 *
 * Three-voice mining-offtake / licence debate preset (PO-7). Adapts
 * LITFIN's credit-decision debate to the mining-estate domain
 * (owner economics vs counterparty protection, synthesised by a
 * pragmatic operations manager).
 *
 * NOTE: the package directory and the public export identifiers
 * (`CONSERVATIVE_LANDLORD_SYSTEM`, `PRO_TENANT_SYSTEM`,
 * `PRAGMATIC_PM_SYSTEM`, `DEFAULT_PROPERTY_STATUTE_CLAUSES`,
 * `runPropertyVoicesDebate`) retain their historical "property"-era
 * names so the api-gateway `typeof` bundle in
 * `services/api-gateway/src/composition/ported-utilities-wiring.ts`
 * keeps compiling. Their VALUES and semantics are now mining-domain.
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
