/**
 * Repository exports for BORJIE database.
 *
 * Property-domain repositories (customer, lease, payment, maintenance,
 * inspection, scheduling, utilities, compliance, messaging, property,
 * hr, operations, vacancy-pipeline) were deleted in the pre-Borjie
 * hard-fork. Re-introduce mining-domain equivalents (buyers,
 * shipments, assays, etc.) under the mining schemas as those domains
 * land.
 */

export {
  buildPaginatedResult,
  DEFAULT_PAGINATION,
} from './base.repository.js';

export { TenantRepository, UserRepository } from './tenant.repository.js';

// Brain — Thread Store. Reads conversation.schema, which survives the
// hard-fork. Required by the kernel composition root.
export { BrainThreadRepository } from './brain-thread.repository.js';
export type {
  BrainThread,
  BrainThreadEvent,
} from './brain-thread.repository.js';

// Sovereign four-eye approvals (migration 0115). Postgres adapter for
// the kernel's ApprovalStore port.
export {
  createPgApprovalStore,
  type ApprovalRecord as PgApprovalRecord,
  type ApprovalSignature as PgApprovalSignature,
  type ApprovalStatus as PgApprovalStatus,
  type ApprovalStore as PgApprovalStore,
  type PgApprovalStoreScope,
  type ProposedAction as PgProposedAction,
} from './sovereign-approvals.repository.js';

// Piece A (Universal Asset & Entity Model) — polymorphic root + per-type
// extension repositories. Single public class CoreEntityRepository covers
// insert / find / recursive descent / custom-field validation / hybrid
// BM25 + dense + geo search with MMR rerank.
export {
  CoreEntityRepository,
  mmrRerank,
  type CoreEntityInput,
  type CoreEntityCommon,
  type LandEntityInput,
  type BuildingEntityInput,
  type SubUnitEntityInput,
  type VehicleEntityInput,
  type MachineryEntityInput,
  type ItAssetEntityInput,
  type PersonEntityInput,
  type IntangibleEntityInput,
  type SearchHybridParams,
  type SearchHit,
  type AddCustomFieldParams,
} from './core-entity.repository.js';

// Enum guards — bug fix A-BUG-DEEP #9. Property-domain enums (lease,
// customer, document) retained as opaque type aliases until the
// mining-domain equivalents replace them.
export {
  assertLeaseStatus,
  assertLeaseStatuses,
  assertCustomerStatus,
  assertCustomerStatuses,
  assertUserStatus,
  assertDocumentStatus,
  assertDocumentType,
  LEASE_STATUS_VALUES,
  CUSTOMER_STATUS_VALUES,
  USER_STATUS_VALUES,
  DOCUMENT_STATUS_VALUES,
  DOCUMENT_TYPE_VALUES,
  type LeaseStatus,
  type CustomerStatus,
  type UserStatus,
  type DocumentStatus,
  type DocumentType,
} from './enum-guards.js';
