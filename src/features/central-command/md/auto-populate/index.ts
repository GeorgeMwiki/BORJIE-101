/**
 * Auto-Populate — public surface.
 *
 * The MD orchestrator imports from this barrel. Internal modules import
 * from each other by relative path.
 */

export {
  ALL_ENTITY_KINDS,
  DEFAULT_CONFIDENCE_THRESHOLD,
  ENTITY_KIND_TO_TABLE,
  canonicaliseName,
  customerSchema,
  decisionSchema,
  employeeSchema,
  extractedEntitySchema,
  feedbackSchema,
  goalSchema,
  meetingSchema,
  opportunitySchema,
  productSchema,
  projectSchema,
  riskSchema,
  supplierSchema,
} from "./entity-types";
export type {
  Customer,
  Decision,
  Employee,
  EntityKind,
  ExtractedEntity,
  Feedback,
  Goal,
  Meeting,
  Opportunity,
  Product,
  Project,
  Risk,
  SourceSpan,
  Supplier,
} from "./entity-types";

export {
  extractEntities,
  isKnownEntityKind,
  parseEntitiesFromRaw,
} from "./extractor";
export type {
  ContextMessage,
  ExtractorInput,
  ExtractorResult,
} from "./extractor";

export {
  collapseIntraTurnDuplicates,
  jaccardTokenRatio,
  levenshtein,
  levenshteinRatio,
  mergeEntities,
  resolveEntity,
} from "./dedupe";
export type {
  DedupeAction,
  DedupeMatch,
  DedupeOptions,
  KnownEntity,
} from "./dedupe";

export { gateBatch, gateEntity, renderConfirmPrompt } from "./confidence-gate";
export type { GateDecision, GateOptions, GatedEntity } from "./confidence-gate";

export { fetchKnownEntities, persistEntity } from "./persister";
export type {
  PersistContext,
  PersistErr,
  PersistOk,
  PersistResult,
} from "./persister";

export {
  auditInputToRow,
  listAuditRows,
  recordAudit,
  updateOwnerConfirmation,
} from "./audit-trail";
export type { AuditRow, AuditRowInput, OwnerConfirmation } from "./audit-trail";

export { processChat } from "./auto-populate-service";
export type {
  ProcessChatContext,
  ProcessChatResult,
} from "./auto-populate-service";
