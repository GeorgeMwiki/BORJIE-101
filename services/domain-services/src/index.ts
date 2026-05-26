// @ts-nocheck — barrel re-export collisions (CustomerCreatedEvent, Invoice, DateRange, etc.) across nested submodules; needs explicit named re-exports across ~30 symbols. Tracked.
/**
 * @borjie/domain-services
 *
 * Core domain services for the BORJIE platform.
 * Implements business logic and data persistence with tenant isolation.
 */

// Common infrastructure
export * from './common/index.js';

// Tenant services - create, update, getPolicyConstitution
export * from './tenant/index.js';

// Identity services
export * from './identity/index.js';

// Property services - CRUD, getOccupancy, getUnits
export * from './property/index.js';

// Customer services - onboard, updateProfile, getTimeline
export * from './customer/index.js';

// Lease services - create, renew, terminate, getActive
export * from './lease/index.js';

// Invoice services - generate, send, getOutstanding
export * from './invoice/index.js';

// Payment services
export * from './payment/index.js';

// Maintenance services - createRequest, dispatch, complete
export * from './maintenance/index.js';

// Document services - upload, verify, getEvidencePack
export * from './document/index.js';

// Report services - getDashboard, getStatement, exportPdf
export * from './report/index.js';

// Feedback services
export * from './feedback/index.js';

// Inspection services
export * from './inspections/index.js';

// Scheduling services
export * from './scheduling/index.js';

// Approval workflow services
export * from './approvals/index.js';

// Utilities tracking services
export * from './utilities/index.js';

// Audit logging services
export * from './audit/index.js';

// Messaging/Chat services
export * from './messaging/index.js';

// Compliance/Legal services
export * from './compliance/index.js';

// Case management services
export * from './cases/index.js';

// Vendor management services
export * from './vendor/index.js';

// Marketplace bundle: Negotiation (NEW 1), Marketplace + Tenders (NEW 11),
// Waitlist Auto-Outreach (NEW 12).
export * as Negotiation from './negotiation/index.js';
export * as Marketplace from './marketplace/index.js';
export * as Waitlist from './waitlist/index.js';

// Reports bundle: Occupancy Timeline (NEW 22), Station-Master Routing (NEW 18).
export * as OccupancyTimeline from './occupancy/index.js';
export * as Routing from './routing/index.js';

// Flat re-exports for the composition root (service-registry) —
// MigrationService, Gamification, and the documents/letters surface are
// pulled directly by the api-gateway without a namespace alias.
export * from './migration/index.js';
export * from './gamification/index.js';
export * from './documents/index.js';

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
