/**
 * Canonical Property Graph (CPG) — Relationship Types (Edges)
 *
 * Directional, verb-based relationship types.
 * Each relationship carries optional temporal + metadata properties.
 *
 * Design rules enforced:
 *  1. Every operational node connects to exactly one primary location anchor
 *  2. Documents attach to both submitter AND supporting event
 *  3. TenantProfile is the tenancy context (not Person directly)
 */

// ─── Org / Geography / Governance ────────────────────────────────────────────

export const ORG_RELATIONSHIPS = [
  'HAS_REGION',            // (Org)-[:HAS_REGION]->(Region)
  'HAS_AREA',              // (Region)-[:HAS_AREA]->(Area)
  'HAS_PROPERTY',          // (Area)-[:HAS_PROPERTY]->(Property)
  'HAS_POLICY',            // (Org)-[:HAS_POLICY]->(Policy)
  'HAS_APPROVAL_MATRIX',   // (Policy)-[:HAS_APPROVAL_MATRIX]->(ApprovalMatrix)
  'HAS_ROLE',              // (User)-[:HAS_ROLE]->(Role)
  'CAN_APPROVE',           // (Role)-[:CAN_APPROVE {actionType, threshold}]->(ApprovalMatrix)
  'MANAGED_BY',            // (Property)-[:MANAGED_BY]->(User)
  'OWNED_BY',              // (Property)-[:OWNED_BY]->(User|Person)
] as const;

// ─── Property Physical Hierarchy ─────────────────────────────────────────────

export const PROPERTY_HIERARCHY_RELATIONSHIPS = [
  'HAS_BUILDING',          // (Property)-[:HAS_BUILDING]->(Building)
  'HAS_BLOCK',             // (Building)-[:HAS_BLOCK]->(Block)
  'HAS_FLOOR',             // (Block)-[:HAS_FLOOR]->(Floor)
  'HAS_UNIT',              // (Floor|Property)-[:HAS_UNIT]->(Unit)
  'HAS_SPACE',             // (Unit)-[:HAS_SPACE]->(Space)
  'HAS_ASSET',             // (Space|Unit|Parcel|SubParcel)-[:HAS_ASSET]->(Asset)
] as const;

// ─── Land Hierarchy ──────────────────────────────────────────────────────────

export const LAND_HIERARCHY_RELATIONSHIPS = [
  'HAS_PARCEL',            // (Property)-[:HAS_PARCEL]->(Parcel)
  'HAS_SUBPARCEL',         // (Parcel)-[:HAS_SUBPARCEL]->(SubParcel)
  'HAS_IMPROVEMENT',       // (SubParcel)-[:HAS_IMPROVEMENT]->(Improvement)
] as const;

// ─── People & Occupancy ──────────────────────────────────────────────────────

export const PEOPLE_RELATIONSHIPS = [
  'MEMBER_OF',             // (Person)-[:MEMBER_OF]->(Household)
  'FOR_PERSON',            // (TenantProfile)-[:FOR_PERSON]->(Person)
  'FOR_CUSTOMER',          // (TenantProfile)-[:FOR_CUSTOMER]->(Customer)
  'OCCUPIES',              // (TenantProfile)-[:OCCUPIES]->(Unit)
  'LEASES_LAND',           // (TenantProfile)-[:LEASES_LAND]->(Parcel|SubParcel)
] as const;

// ─── Contracts ───────────────────────────────────────────────────────────────

export const CONTRACT_RELATIONSHIPS = [
  'APPLIES_TO',            // (Lease)-[:APPLIES_TO]->(Unit) | (LandLease)-[:APPLIES_TO]->(Parcel)
  'HAS_LEASE',             // (TenantProfile)-[:HAS_LEASE]->(Lease|LandLease)
  'HAS_VERSION',           // (Lease)-[:HAS_VERSION]->(ContractVersion)
  'HAS_DOCUMENT',          // (ContractVersion)-[:HAS_DOCUMENT]->(Document)
  'RENEWED_FROM',          // (Lease)-[:RENEWED_FROM]->(Lease) — lease chain
] as const;

// ─── Documents & Verification ────────────────────────────────────────────────

export const DOCUMENT_RELATIONSHIPS = [
  'SUBMITTED',             // (Person)-[:SUBMITTED]->(Document)
  'VERIFIED_BY',           // (Document)-[:VERIFIED_BY]->(Verification)
  'ISSUED_BADGE',          // (Verification)-[:ISSUED_BADGE]->(Badge)
  'HAS_BADGE',             // (TenantProfile)-[:HAS_BADGE]->(Badge)
  'RELATES_TO',            // (Document)-[:RELATES_TO]->(Lease|Payment|WorkOrder|Case|Notice)
  'ATTACHED_TO',           // (Document)-[:ATTACHED_TO]->(Case|WorkOrder|Inspection|Notice)
] as const;

// ─── Maintenance & Operations ────────────────────────────────────────────────

export const OPS_RELATIONSHIPS = [
  'REPORTED_BY',           // (Issue|MaintenanceRequest)-[:REPORTED_BY]->(TenantProfile|Customer)
  'ABOUT',                 // (Issue|Case|Message)-[:ABOUT]->(Unit|Space|Asset|Parcel|WorkOrder|Invoice)
  'CREATED_FROM',          // (WorkOrder)-[:CREATED_FROM]->(Issue|MaintenanceRequest)
  'TARGETS',               // (WorkOrder)-[:TARGETS]->(Unit|Space|Asset|Parcel|SubParcel)
  'ASSIGNED_TO',           // (WorkOrder)-[:ASSIGNED_TO]->(Vendor|User)
  'HAS_SLA_EVENT',         // (WorkOrder)-[:HAS_SLA_EVENT]->(SLAEvent)
  'INSPECTS',              // (Inspection)-[:INSPECTS]->(Unit|Parcel|SubParcel)
  'CREATED_WORKORDER',     // (Inspection)-[:CREATED_WORKORDER]->(WorkOrder)
  'SENT_TO',               // (Message)-[:SENT_TO]->(TenantProfile|Vendor|User)
  'SENT_BY',               // (Message)-[:SENT_BY]->(User|TenantProfile)
] as const;

// ─── Finance ─────────────────────────────────────────────────────────────────

export const FINANCE_RELATIONSHIPS = [
  'BILLED_TO',             // (Invoice)-[:BILLED_TO]->(TenantProfile|Customer)
  'FOR_LEASE',             // (Invoice)-[:FOR_LEASE]->(Lease|LandLease)
  'FOR_UNIT',              // (Invoice)-[:FOR_UNIT]->(Unit)
  'PAYS',                  // (Payment)-[:PAYS]->(Invoice)
  'FOR_TENANT',            // (PaymentPlan)-[:FOR_TENANT]->(TenantProfile|Customer)
  'COVERS',                // (PaymentPlan)-[:COVERS]->(Invoice)
  'APPLIED_TO',            // (Concession)-[:APPLIED_TO]->(Invoice)
  'POSTED_FOR',            // (LedgerEntry)-[:POSTED_FOR]->(Invoice|Payment|Concession)
  'DISBURSED_TO',          // (Disbursement)-[:DISBURSED_TO]->(User) — property owner
  'DISBURSED_FROM',        // (Disbursement)-[:DISBURSED_FROM]->(Property)
] as const;

// ─── Credit Reporting ────────────────────────────────────────────────────────

export const CREDIT_RELATIONSHIPS = [
  'RENT_REPORTED_FOR',     // (RentReportingEvent)-[:RENT_REPORTED_FOR]->(TenantProfile)
  'BASED_ON',              // (RentReportingEvent)-[:BASED_ON]->(Invoice)
] as const;

// ─── Legal & Disputes ────────────────────────────────────────────────────────

export const LEGAL_RELATIONSHIPS = [
  'OPENED_BY',             // (Case)-[:OPENED_BY]->(TenantProfile|User|Customer)
  'AGAINST',               // (Case)-[:AGAINST]->(TenantProfile|Org|Vendor|Customer)
  'CASE_ABOUT',            // (Case)-[:CASE_ABOUT]->(Lease|Unit|Parcel|WorkOrder|Invoice|Issue)
  'ISSUED_FOR',            // (Notice)-[:ISSUED_FOR]->(Case|Invoice|Lease|LandLease)
  'SERVED_TO',             // (Notice)-[:SERVED_TO]->(TenantProfile|Customer)
  'FOR_CASE',              // (EvidencePack|CaseResolution)-[:FOR_CASE]->(Case)
  'INCLUDES',              // (EvidencePack)-[:INCLUDES]->(Document|Message|WorkOrder|Invoice|Inspection|Payment|Notice)
  'PARENT_CASE',           // (Case)-[:PARENT_CASE]->(Case) — escalation chain
  'RESOLVED_BY',           // (Case)-[:RESOLVED_BY]->(CaseResolution)
] as const;

// ─── Market & Green Intelligence ─────────────────────────────────────────────

export const MARKET_RELATIONSHIPS = [
  'COMPARABLE_TO',         // (CompListing)-[:COMPARABLE_TO]->(Unit)
  'READING_FOR',           // (UtilityReading)-[:READING_FOR]->(Unit|Property|Parcel)
  'DETECTED_ON',           // (AnomalyEvent)-[:DETECTED_ON]->(UtilityReading)
  'PROPOSED_FOR',          // (RetrofitProposal)-[:PROPOSED_FOR]->(Property|Building|Unit)
  'PROPOSAL_BASED_ON',     // (RetrofitProposal)-[:PROPOSAL_BASED_ON]->(UtilityReading|WorkOrder|OutageEvent)
] as const;

// ─── Timeline (cross-cutting) ────────────────────────────────────────────────

export const TIMELINE_RELATIONSHIPS = [
  'HAS_EVENT',             // (*)-[:HAS_EVENT]->(TimelineEvent) — anything can have timeline events
  'TRIGGERED_BY',          // (TimelineEvent)-[:TRIGGERED_BY]->(User|TenantProfile)
] as const;

// ─── All relationships combined ──────────────────────────────────────────────

export const ALL_RELATIONSHIP_TYPES = [
  ...ORG_RELATIONSHIPS,
  ...PROPERTY_HIERARCHY_RELATIONSHIPS,
  ...LAND_HIERARCHY_RELATIONSHIPS,
  ...PEOPLE_RELATIONSHIPS,
  ...CONTRACT_RELATIONSHIPS,
  ...DOCUMENT_RELATIONSHIPS,
  ...OPS_RELATIONSHIPS,
  ...FINANCE_RELATIONSHIPS,
  ...CREDIT_RELATIONSHIPS,
  ...LEGAL_RELATIONSHIPS,
  ...MARKET_RELATIONSHIPS,
  ...TIMELINE_RELATIONSHIPS,
] as const;

export type RelationshipType = typeof ALL_RELATIONSHIP_TYPES[number];

/**
 * Common properties on relationship edges.
 */
export interface BaseEdgeProperties {
  _syncedAt: string;      // When this edge was last synced
  _sourceFK?: string;     // Source foreign key column
  since?: string;         // ISO 8601 — when relationship started
  until?: string;         // ISO 8601 — when relationship ended (temporal edges)
  weight?: number;        // Confidence weight (0-1) for inferred relationships
}
