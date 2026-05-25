/**
 * Audit Trail v2 barrel — Wave 27 Agent C.
 */

export type {
  AuditActionCategory,
  AuditActor,
  AuditActorKind,
  AuditAiEvidence,
  AuditDecision,
  AuditSubject,
  AuditTrailEntry,
  AuditTrailRepository,
  HashChainPort,
  RecordAuditInput,
  VerifyRangeResult,
} from './types.js';

export {
  AUDIT_TRAIL_SIGNING_SECRET_ENV,
  GENESIS_PREV_HASH_V2,
} from './types.js';

export {
  canonicalEvidence,
  hashEntry,
  resolveSigningSecret,
  signHash,
  verifySignature,
} from './hash-chain.js';

export {
  createAuditTrailRecorder,
  createInMemoryAuditTrailRepo,
  type AuditTrailRecorder,
  type AuditTrailRecorderDeps,
} from './recorder.js';

export {
  createAuditTrailVerifier,
  type AuditTrailVerifier,
  type AuditTrailVerifierDeps,
  type VerifyRangeOptions,
} from './verifier.js';

export {
  exportBundle,
  streamBundleNdjson,
  type AuditTrailBundle,
  type BundleDeps,
  type ExportBundleOptions,
} from './bundle.js';
