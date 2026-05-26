/**
 * @borjie/domain-services
 *
 * Core domain services for the BORJIE platform.
 * Implements business logic and data persistence with tenant isolation.
 *
 * Re-export strategy: submodules with symbol-name collisions across the
 * package surface (Invoice, CustomerId, InvoiceId, DateRange, Document*,
 * EventBus, etc.) are exposed under namespace aliases. Consumers that
 * need the colliding symbols should import from the submodule path
 * directly (e.g. `@borjie/domain-services/cases`).
 */

// Common infrastructure (owns EventBus, DomainEvent, EventEnvelope,
// repository/UnitOfWork interfaces and id-generator helpers).
export * from './common/index.js';

// Tenant services - create, update, getPolicyConstitution
export * from './tenant/index.js';

// Identity services (owns AuditService, AuditedActor, etc.)
export * from './identity/index.js';

// Property services - CRUD, getOccupancy, getUnits
export * from './property/index.js';

// Customer services (owns CustomerId, CustomerRepository, CustomerCreatedEvent,
// FinancialStatement).
export * from './customer/index.js';

// Lease services. Lease-specific value objects (ConditionRating,
// CustomerCreatedEvent re-export from move-in inspection, etc.) are
// scoped to the namespace to avoid collisions with customer/maintenance.
export * as Lease from './lease/index.js';

// Invoice services (owns Invoice, InvoiceId, InvoiceLineItem,
// InvoicePaidEvent, InvoiceRepository, InvoiceStatus, RecordPaymentInput).
export * from './invoice/index.js';

// Payment services. Payment-side mirrors of Invoice symbols are
// namespaced to avoid collision with invoice/.
export * as Payment from './payment/index.js';

// Maintenance services (owns CreateVendorInput, UpdateVendorInput,
// VendorContact, VendorPerformanceMetrics, VendorRateCard,
// VendorRepository, VendorStatus).
export * from './maintenance/index.js';

// Document services (singular — owns Document, DocumentId,
// DocumentRepository, DocumentService, EvidencePack, etc.).
export * from './document/index.js';

// Report services. Report-side FinancialStatement is namespaced to
// avoid collision with customer/.
export * as Report from './report/index.js';

// Feedback services
export * from './feedback/index.js';

// Inspections services. Inspections re-export lease-derived
// ConditionRating; expose under namespace.
export * as Inspections from './inspections/index.js';

// Approval workflow services
export * from './approvals/index.js';

// Utilities tracking services. Owns its own DateRange shape;
// namespace to avoid collision with audit/.
export * as Utilities from './utilities/index.js';

// Audit logging services. AuditService re-export collides with
// identity/audit-service; expose under namespace.
export * as Audit from './audit/index.js';

// Messaging/Chat services
export * from './messaging/index.js';

// Compliance/Legal services. Owns CaseStatus, NoticeType which the
// cases/ submodule shadows; expose under namespace.
export * as Compliance from './compliance/index.js';

// Case management services. Defines local branded CustomerId,
// InvoiceId that shadow customer/invoice; namespace.
export * as Cases from './cases/index.js';

// Vendor management services. Defines vendor surface that overlaps
// maintenance/vendor; namespace.
export * as Vendor from './vendor/index.js';

// Marketplace bundle: Negotiation (NEW 1), Marketplace + Tenders (NEW 11),
// Waitlist Auto-Outreach (NEW 12).
export * as Negotiation from './negotiation/index.js';
export * as Marketplace from './marketplace/index.js';
export * as Waitlist from './waitlist/index.js';

// Reports bundle: Occupancy Timeline (NEW 22), Station-Master Routing (NEW 18).
export * as OccupancyTimeline from './occupancy/index.js';
export * as Routing from './routing/index.js';

// Migration services. MigrationService and PostgresMigrationRepository
// are consumed flat by api-gateway routes; re-export those plus the
// other migration surface explicitly to avoid pulling a duplicate
// EventBus interface declared inside migration-service.ts.
export {
  MigrationService,
  PostgresMigrationRepository,
} from './migration/index.js';
export type {
  MigrationRun,
  MigrationRunStatus,
  MigrationRunCounts,
  MigrationCommittedEvent,
  IMigrationRepository,
  MigrationBundle,
  RunInTransactionResult,
  MigrationServiceDeps,
  CommitError,
  CommitOk,
  CommitResult,
  DrizzleLike,
  PostgresMigrationRepositoryDeps,
} from './migration/index.js';

// Gamification module. Service factory is flat; namespace the rest to
// avoid the EventBus collision with common/.
export { createGamificationService } from './gamification/index.js';
export * as Gamification from './gamification/index.js';

// Documents (plural) — letters/file-management surface consumed flat by
// api-gateway routes. Re-export the public letter surface explicitly so
// Document* names from this module don't collide with document/ (singular).
export {
  LetterService,
  TextRenderer,
} from './documents/index.js';
export type {
  ILetterRepository,
  LetterRequestRecord,
  LetterPayload,
} from './documents/index.js';
export * as Documents from './documents/index.js';

// Wave 8 gap closures — Warehouse inventory (S7), IoT observations (S3).
// MaintenanceTaxonomy was retired during the mining hard-fork; its
// mining-domain replacement is `EquipmentMaintenanceTaxonomy` below.
export * as Warehouse from './warehouse/index.js';
export * as Iot from './iot/index.js';

// Wave 9 enterprise polish — Feature flags per tenant.
export * as FeatureFlags from './feature-flags/index.js';

// Mining hard-fork wave 6 — mining-domain replacements for the seven
// remaining property-domain repositories.
export * as WorkerIncentives from './worker-incentives/index.js';
export * as SitePreShiftInspection from './site-pre-shift-inspection/index.js';
export * as OreGradingWeights from './ore-grading-weights/index.js';
export * as SiteLiveMetrics from './site-live-metrics/index.js';
export * as SiteSupervisorCoverage from './site-supervisor-coverage/index.js';
export * as OfftakeQueue from './offtake-queue/index.js';
export * as EquipmentMaintenanceTaxonomy from './equipment-maintenance-taxonomy/index.js';
