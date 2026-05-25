/**
 * Constitution module barrel.
 *
 * BORJIE Constitution v1 + citation verifier. See
 * `borjie-constitution.ts` for clause text and `citation-verifier.ts`
 * for the deliberative-alignment evaluator.
 */

export {
  BORJIE_CONSTITUTION_V1,
  clausesForAction,
  clausesForJurisdiction,
  renderConstitutionAsContext,
  getClause,
  type ClauseSeverity,
  type Jurisdiction,
  type ClauseCitation,
  type ConstitutionClause,
} from './borjie-constitution.js';

export {
  applicableClauses,
  verifyResponse,
  renderAuditTrace,
  getClauseById,
  type VerifyInput,
  type VerifyVerdict,
  type ClauseResult,
} from './citation-verifier.js';
