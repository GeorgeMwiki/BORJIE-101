/**
 * support-cases — Mr. Mwikila's persistent technical-support memory service.
 *
 * Public surface:
 *   - openCase / openCaseFromDiagnosis / getCase / updateCase / resolveCase /
 *     escalateCase / listCases / listActiveCases — the tenant+user-scoped,
 *     GUC-bound, audit-appending repository over `support_cases`.
 *   - recallSupportMemory / buildRecallPreamble — the "never loses memory"
 *     RECALL hook the brain turn path calls at turn start (a cheap query, NOT
 *     an LLM call) to inject the user's in-flight cases into the brain context.
 *   - appendSupportAudit — the hash-chained, append-only ai_audit_chain writer.
 *
 * See ./repository.ts for the hard-rule rationale (no money writes; evidence-
 * required; RLS + GUC; append-only immutable audit).
 */

export {
  ACTIVE_CASE_STATUSES,
  bindTenantGuc,
  openCase,
  openCaseFromDiagnosis,
  getCase,
  updateCase,
  resolveCase,
  escalateCase,
  listCases,
  listActiveCases,
  type SupportRepoContext,
  type SupportRepoDb,
  type SupportRepoLogger,
  type OpenCaseInput,
  type UpdateCaseInput,
} from './repository.js';

export {
  recallSupportMemory,
  buildRecallPreamble,
  type RecallLang,
  type RecallResult,
} from './recall.js';

export {
  appendSupportAudit,
  type SupportAuditKind,
  type SupportAuditPayload,
} from './audit.js';
