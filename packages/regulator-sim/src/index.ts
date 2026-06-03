/**
 * `@borjie/regulator-sim` — public surface.
 *
 * Regulator-readiness simulation (LP-16 / PO-20) for the Borjie
 * mining-estate OS. Three capabilities, all pure:
 *
 *   1. Audit replay over a date range, asserting decision invariants
 *      (CoT present, bilingual notes, registered model, fresh model card,
 *      allowed reason codes, four-eye distinct approvers, fairness deltas).
 *   2. Tanzania PDPA subject-access + erasure drills (legal-hold aware).
 *   3. A deterministic mining-regulator supervision document pack.
 *
 * Ported from LITFIN `src/core/security/regulator-sim`, re-skinned to
 * mining licence / royalty / payout decisions.
 */

export {
  type DecisionOutcome,
  type DecisionDomain,
  type DecisionRecord,
  type AuditReplayInput,
  type AuditFindingCode,
  type FindingSeverity,
  type AuditFinding,
  type AuditReplayResult,
  type SubjectAccessRequest,
  type ErasureRequest,
  type PdpaAction,
  type PdpaResult,
  type SupervisionPackInput,
  type SupervisionDocument,
  type SupervisionPackResult,
  DEFAULT_ALLOWED_REASON_CODES,
} from './types.js';

export { replayAudit, summarizeAudit } from './audit-replay.js';

export {
  buildSupervisionPack,
  SUPERVISION_PACK_REQUIRED_SECTIONS,
} from './supervision-pack.js';

export {
  createInMemoryPdpaSurface,
  fulfilSubjectAccess,
  fulfilErasure,
  pdpaEndToEnd,
  type SubjectArtefact,
  type SubjectArtefactKind,
  type PdpaSurface,
} from './pdpa-readiness.js';
