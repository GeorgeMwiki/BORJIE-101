/**
 * Repository exports for BORJIE database
 */

export {
  buildPaginatedResult,
  DEFAULT_PAGINATION,
} from './base.repository.js';

export { TenantRepository, UserRepository } from './tenant.repository.js';
export { PropertyRepository, UnitRepository } from './property.repository.js';
export {
  CustomerRepository,
  type CustomerFilters,
} from './customer.repository.js';
export {
  LeaseRepository,
  type LeaseFilters,
} from './lease.repository.js';
export {
  InvoiceRepository,
  PaymentRepository,
  TransactionRepository,
} from './payment.repository.js';
export {
  WorkOrderRepository,
  VendorRepository,
} from './maintenance.repository.js';
export { InspectionRepository } from './inspection.repository.js';
export { MessagingRepository } from './messaging.repository.js';
export { SchedulingRepository } from './scheduling.repository.js';
export { UtilitiesRepository } from './utilities.repository.js';
export { ComplianceRepository, DocumentRepository } from './compliance.repository.js';

// Operations — dispatch events, completion proofs, vendor assignments
export {
  DispatchEventRepository,
  CompletionProofRepository,
  VendorAssignmentRepository,
} from './operations.repository.js';

// Brain — Thread Store + HR
export { BrainThreadRepository } from './brain-thread.repository.js';
export type {
  BrainThread,
  BrainThreadEvent,
} from './brain-thread.repository.js';
export {
  DepartmentRepository,
  TeamRepository,
  EmployeeRepository,
  AssignmentRepository,
  PerformanceRepository,
  type EmployeeRankingRow,
} from './hr.repository.js';

// Vacancy-to-lease pipeline (migration 0098). Postgres adapter for the
// VacancyPipelineRunRepository port consumed by the orchestrator
// service in @borjie/ai-copilot.
export {
  createPgVacancyPipelineRunRepository,
  type VacancyPipelineRun as PgVacancyPipelineRun,
  type VacancyPipelineRunRepository as PgVacancyPipelineRunRepository,
  type VacancyPipelineEvent as PgVacancyPipelineEvent,
  type VacancyPipelineState as PgVacancyPipelineState,
} from './vacancy-pipeline.repository.js';

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

// Enum guards — bug fix A-BUG-DEEP #9.
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
