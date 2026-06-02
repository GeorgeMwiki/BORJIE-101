/**
 * Canonical Mining Graph (CMG) — Node Labels
 *
 * Every node label maps to a real-world entity in the Borjie mining
 * domain. Labels are grouped by bounded context and must stay in sync
 * with the PostgreSQL source-of-truth schemas.
 *
 * Naming conventions:
 *  - PascalCase labels (Neo4j convention)
 *  - Every node carries `_id` (source PK), `_tenantId`, `_syncedAt`
 */

// ─── Organization & Governance ───────────────────────────────────────────────

export const ORG_LABELS = [
  'Org',               // Enterprise customer / owner corporation
  'Region',            // Geographic region grouping
  'Area',              // District / city / zone within a region
  'Policy',            // Ruleset + constitution (royalty escalation, SLA, etc.)
  'ApprovalMatrix',    // Approval thresholds per action type
  'Role',              // RBAC role definition
  'User',              // Staff / system user
  'Vendor',            // External service provider
] as const;

// ─── Sites & Physical World ──────────────────────────────────────────────────

export const SITE_LABELS = [
  'Site',              // Estate / licence-level management entity
  'Building',          // Physical building within a site
  'Zone',              // Wing / zone within a building
  'Floor',             // Floor level
  'Pit',               // Individual workable/extractable space
  'Space',             // Room or sub-space within a pit
  'Asset',             // Fixture / equipment / plant
  'Parcel',            // Land parcel
  'SubParcel',         // Section of a land parcel
  'Improvement',       // Structure on parcel (fence, borehole, etc.)
] as const;

// ─── People & Relationships ──────────────────────────────────────────────────

export const PEOPLE_LABELS = [
  'Person',            // Natural person (counterparty, guarantor, owner)
  'Household',         // Group of persons sharing a pit
  'CounterpartyProfile', // Person-in-this-org-at-this-site context
  'Customer',          // Customer account (maps to PostgreSQL customers)
] as const;

// ─── Contracts & Documents ───────────────────────────────────────────────────

export const CONTRACT_LABELS = [
  'Offtake',           // Pit offtake agreement
  'LandLease',         // Parcel lease agreement
  'ContractVersion',   // Versioned contract snapshot
  'Document',          // ID doc, offtake PDF, title doc, notice, invoice
  'Verification',      // KYC verification result
  'Badge',             // Verified ID, Verified Offtake, etc.
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
  ...SITE_LABELS,
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
