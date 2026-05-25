/**
 * Canonical Property Graph (CPG) — Node Labels
 *
 * Every node label maps to a real-world entity in the Boss Nyumba domain.
 * Labels are grouped by bounded context and must stay in sync with
 * the PostgreSQL source-of-truth schemas.
 *
 * Naming conventions:
 *  - PascalCase labels (Neo4j convention)
 *  - Every node carries `_id` (source PK), `_tenantId`, `_syncedAt`
 */

// ─── Organization & Governance ───────────────────────────────────────────────

export const ORG_LABELS = [
  'Org',               // Enterprise customer / landlord corporation
  'Region',            // Geographic region grouping
  'Area',              // District / city / zone within a region
  'Policy',            // Ruleset + constitution (rent escalation, SLA, etc.)
  'ApprovalMatrix',    // Approval thresholds per action type
  'Role',              // RBAC role definition
  'User',              // Staff / system user
  'Vendor',            // External service provider
] as const;

// ─── Properties & Physical World ─────────────────────────────────────────────

export const PROPERTY_LABELS = [
  'Property',          // Address-level management entity
  'Building',          // Physical building within a property
  'Block',             // Wing / block within a building
  'Floor',             // Floor level
  'Unit',              // Individual rentable/sellable space
  'Space',             // Room or sub-space within a unit
  'Asset',             // Fixture / appliance / equipment
  'Parcel',            // Land parcel
  'SubParcel',         // Section of a land parcel
  'Improvement',       // Structure on parcel (fence, borehole, etc.)
] as const;

// ─── People & Relationships ──────────────────────────────────────────────────

export const PEOPLE_LABELS = [
  'Person',            // Natural person (tenant, guarantor, owner)
  'Household',         // Group of persons sharing a unit
  'TenantProfile',     // Person-in-this-org-at-this-property context
  'Customer',          // Customer account (maps to PostgreSQL customers)
] as const;

// ─── Contracts & Documents ───────────────────────────────────────────────────

export const CONTRACT_LABELS = [
  'Lease',             // Unit lease agreement
  'LandLease',         // Parcel lease agreement
  'ContractVersion',   // Versioned contract snapshot
  'Document',          // ID doc, lease PDF, title doc, notice, invoice
  'Verification',      // KYC verification result
  'Badge',             // Verified ID, Verified Lease, etc.
] as const;

// ─── Operations ──────────────────────────────────────────────────────────────

export const OPS_LABELS = [
  'WorkOrder',         // Maintenance work order
  'MaintenanceRequest', // Original maintenance request
  'Task',              // Compliance task / inspection task
  'Inspection',        // Scheduled or ad-hoc inspection
  'Issue',             // Complaint / defect / incident
  'Message',           // WhatsApp / email / app message
  'Announcement',      // Broadcast announcement
] as const;

// ─── Finance ─────────────────────────────────────────────────────────────────

export const FINANCE_LABELS = [
  'Invoice',           // Billing invoice
  'Payment',           // Payment transaction
  'LedgerEntry',       // Immutable ledger record
  'PaymentPlan',       // Structured payment arrangement
  'Concession',        // Discount / waiver
  'Disbursement',      // Payment to property owner
  'RentReportingEvent', // Credit bureau reporting record
] as const;

// ─── Legal & Risk ────────────────────────────────────────────────────────────

export const LEGAL_LABELS = [
  'Case',              // Dispute / legal case
  'Notice',            // Legal notice (demand, eviction warning, etc.)
  'EvidencePack',      // Assembled evidence bundle for a case
  'SLAEvent',          // SLA breach / acceptance event
  'CaseResolution',    // Resolution record
] as const;

// ─── Market & Green Intelligence (optional) ──────────────────────────────────

export const MARKET_LABELS = [
  'CompListing',       // Comparable market listing
  'BenchmarkIndex',    // Market benchmark data point
  'UtilityReading',    // Water / kWh / fuel reading
  'AnomalyEvent',      // Detected utility anomaly
  'OutageEvent',       // Service outage record
  'RetrofitProposal',  // Energy efficiency proposal
] as const;

// ─── Timeline (cross-cutting) ────────────────────────────────────────────────

export const TIMELINE_LABELS = [
  'TimelineEvent',     // Generic timestamped event for chronology
] as const;

// ─── All labels combined ─────────────────────────────────────────────────────

export const ALL_NODE_LABELS = [
  ...ORG_LABELS,
  ...PROPERTY_LABELS,
  ...PEOPLE_LABELS,
  ...CONTRACT_LABELS,
  ...OPS_LABELS,
  ...FINANCE_LABELS,
  ...LEGAL_LABELS,
  ...MARKET_LABELS,
  ...TIMELINE_LABELS,
] as const;

export type NodeLabel = typeof ALL_NODE_LABELS[number];

/**
 * Common properties every node MUST have (enforced at ETL time).
 */
export interface BaseNodeProperties {
  _id: string;          // Source primary key from PostgreSQL
  _tenantId: string;    // Multi-tenant isolation key
  _syncedAt: string;    // ISO 8601 timestamp of last sync
  _sourceTable: string; // PostgreSQL source table name
  _version: number;     // Optimistic concurrency version
}
