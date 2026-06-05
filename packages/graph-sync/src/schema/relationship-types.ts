/**
 * Canonical Mining Graph (CMG) — Relationship Types (Edges)
 *
 * Directional, verb-based relationship types.
 * Each relationship carries optional temporal + metadata properties.
 *
 * Design rules enforced:
 *  1. Every operational node connects to exactly one primary location anchor
 *  2. Documents attach to both submitter AND supporting event
 *  3. CounterpartyProfile is the counterparty context (not Person directly)
 */

// ─── Org / Geography / Governance ────────────────────────────────────────────

export const ORG_RELATIONSHIPS = [
  'HAS_REGION',            // (Org)-[:HAS_REGION]->(Region)
  'HAS_AREA',              // (Region)-[:HAS_AREA]->(Area)
  'HAS_SITE',              // (Area)-[:HAS_SITE]->(Site)
  'HAS_POLICY',            // (Org)-[:HAS_POLICY]->(Policy)
  'HAS_APPROVAL_MATRIX',   // (Policy)-[:HAS_APPROVAL_MATRIX]->(ApprovalMatrix)
  'HAS_ROLE',              // (User)-[:HAS_ROLE]->(Role)
  'CAN_APPROVE',           // (Role)-[:CAN_APPROVE {actionType, threshold}]->(ApprovalMatrix)
  'MANAGED_BY',            // (Site)-[:MANAGED_BY]->(User)
  'OWNED_BY',              // (Site)-[:OWNED_BY]->(User|Person)
] as const;

// ─── Site Physical Hierarchy ─────────────────────────────────────────────────

export const SITE_HIERARCHY_RELATIONSHIPS = [
  'HAS_BUILDING',          // (Site)-[:HAS_BUILDING]->(Building)
  'HAS_ZONE',              // (Building)-[:HAS_ZONE]->(Zone)
  'HAS_FLOOR',             // (Zone)-[:HAS_FLOOR]->(Floor)
  'HAS_PIT',               // (Floor|Site)-[:HAS_PIT]->(Pit)
  'HAS_SPACE',             // (Pit)-[:HAS_SPACE]->(Space)
  'HAS_ASSET',             // (Space|Pit|Parcel|SubParcel)-[:HAS_ASSET]->(Asset)
] as const;

// ─── Land Hierarchy ──────────────────────────────────────────────────────────

export const LAND_HIERARCHY_RELATIONSHIPS = [
  'HAS_PARCEL',            // (Site)-[:HAS_PARCEL]->(Parcel)
  'HAS_SUBPARCEL',         // (Parcel)-[:HAS_SUBPARCEL]->(SubParcel)
  'HAS_IMPROVEMENT',       // (SubParcel)-[:HAS_IMPROVEMENT]->(Improvement)
] as const;

// ─── People & Occupancy ──────────────────────────────────────────────────────

export const PEOPLE_RELATIONSHIPS = [
  'MEMBER_OF',             // (Person)-[:MEMBER_OF]->(Household)
  'FOR_PERSON',            // (CounterpartyProfile)-[:FOR_PERSON]->(Person)
  'FOR_CUSTOMER',          // (CounterpartyProfile)-[:FOR_CUSTOMER]->(Customer)
  'OCCUPIES',              // (CounterpartyProfile)-[:OCCUPIES]->(Pit)
  'LEASES_LAND',           // (CounterpartyProfile)-[:LEASES_LAND]->(Parcel|SubParcel)
] as const;

// ─── Contracts ───────────────────────────────────────────────────────────────

export const CONTRACT_RELATIONSHIPS = [
  'APPLIES_TO',            // (Offtake)-[:APPLIES_TO]->(Pit) | (LandLease)-[:APPLIES_TO]->(Parcel)
  'HAS_OFFTAKE',           // (CounterpartyProfile)-[:HAS_OFFTAKE]->(Offtake|LandLease)
  'HAS_VERSION',           // (Offtake)-[:HAS_VERSION]->(ContractVersion)
  'HAS_DOCUMENT',          // (ContractVersion)-[:HAS_DOCUMENT]->(Document)
  'RENEWED_FROM',          // (Offtake)-[:RENEWED_FROM]->(Offtake) — offtake chain
] as const;

// ─── Documents & Verification ────────────────────────────────────────────────

export const DOCUMENT_RELATIONSHIPS = [
  'SUBMITTED',             // (Person)-[:SUBMITTED]->(Document)
  'VERIFIED_BY',           // (Document)-[:VERIFIED_BY]->(Verification)
  'ISSUED_BADGE',          // (Verification)-[:ISSUED_BADGE]->(Badge)
  'HAS_BADGE',             // (CounterpartyProfile)-[:HAS_BADGE]->(Badge)
  'RELATES_TO',            // (Document)-[:RELATES_TO]->(Offtake|Payment|WorkOrder|Case|Notice)
  'ATTACHED_TO',           // (Document)-[:ATTACHED_TO]->(Case|WorkOrder|Inspection|Notice)
] as const;

// ─── Maintenance & Operations ────────────────────────────────────────────────

export const OPS_RELATIONSHIPS = [
  'REPORTED_BY',           // (Issue|MaintenanceRequest)-[:REPORTED_BY]->(CounterpartyProfile|Customer)
  'ABOUT',                 // (Issue|Case|Message)-[:ABOUT]->(Pit|Space|Asset|Parcel|WorkOrder|Invoice)
  'CREATED_FROM',          // (WorkOrder)-[:CREATED_FROM]->(Issue|MaintenanceRequest)
  'TARGETS',               // (WorkOrder)-[:TARGETS]->(Pit|Space|Asset|Parcel|SubParcel)
  'ASSIGNED_TO',           // (WorkOrder)-[:ASSIGNED_TO]->(Vendor|User)
  'HAS_SLA_EVENT',         // (WorkOrder)-[:HAS_SLA_EVENT]->(SLAEvent)
  'INSPECTS',              // (Inspection)-[:INSPECTS]->(Pit|Parcel|SubParcel)
  'CREATED_WORKORDER',     // (Inspection)-[:CREATED_WORKORDER]->(WorkOrder)
  'SENT_TO',               // (Message)-[:SENT_TO]->(CounterpartyProfile|Vendor|User)
  'SENT_BY',               // (Message)-[:SENT_BY]->(User|CounterpartyProfile)
] as const;

// ─── Finance ─────────────────────────────────────────────────────────────────

export const FINANCE_RELATIONSHIPS = [
  'BILLED_TO',             // (Invoice)-[:BILLED_TO]->(CounterpartyProfile|Customer)
  'FOR_OFFTAKE',           // (Invoice)-[:FOR_OFFTAKE]->(Offtake|LandLease)
  'FOR_PIT',               // (Invoice)-[:FOR_PIT]->(Pit)
  'PAYS',                  // (Payment)-[:PAYS]->(Invoice)
  'FOR_COUNTERPARTY',      // (PaymentPlan)-[:FOR_COUNTERPARTY]->(CounterpartyProfile|Customer)
  'COVERS',                // (PaymentPlan)-[:COVERS]->(Invoice)
  'APPLIED_TO',            // (Concession)-[:APPLIED_TO]->(Invoice)
  'POSTED_FOR',            // (LedgerEntry)-[:POSTED_FOR]->(Invoice|Payment|Concession)
  'DISBURSED_TO',          // (Disbursement)-[:DISBURSED_TO]->(User) — site owner
  'DISBURSED_FROM',        // (Disbursement)-[:DISBURSED_FROM]->(Site)
] as const;

// ─── Credit Reporting ────────────────────────────────────────────────────────

export const CREDIT_RELATIONSHIPS = [
  'RENT_REPORTED_FOR',     // (RentReportingEvent)-[:RENT_REPORTED_FOR]->(CounterpartyProfile)
  'BASED_ON',              // (RentReportingEvent)-[:BASED_ON]->(Invoice)
] as const;

// ─── Legal & Disputes ────────────────────────────────────────────────────────

export const LEGAL_RELATIONSHIPS = [
  'OPENED_BY',             // (Case)-[:OPENED_BY]->(CounterpartyProfile|User|Customer)
  'AGAINST',               // (Case)-[:AGAINST]->(CounterpartyProfile|Org|Vendor|Customer)
  'CASE_ABOUT',            // (Case)-[:CASE_ABOUT]->(Offtake|Pit|Parcel|WorkOrder|Invoice|Issue)
  'ISSUED_FOR',            // (Notice)-[:ISSUED_FOR]->(Case|Invoice|Offtake|LandLease)
  'SERVED_TO',             // (Notice)-[:SERVED_TO]->(CounterpartyProfile|Customer)
  'FOR_CASE',              // (EvidencePack|CaseResolution)-[:FOR_CASE]->(Case)
  'INCLUDES',              // (EvidencePack)-[:INCLUDES]->(Document|Message|WorkOrder|Invoice|Inspection|Payment|Notice)
  'PARENT_CASE',           // (Case)-[:PARENT_CASE]->(Case) — escalation chain
  'RESOLVED_BY',           // (Case)-[:RESOLVED_BY]->(CaseResolution)
] as const;

// ─── Market & Green Intelligence ─────────────────────────────────────────────

export const MARKET_RELATIONSHIPS = [
  'COMPARABLE_TO',         // (CompListing)-[:COMPARABLE_TO]->(Pit)
  'READING_FOR',           // (UtilityReading)-[:READING_FOR]->(Pit|Site|Parcel)
  'DETECTED_ON',           // (AnomalyEvent)-[:DETECTED_ON]->(UtilityReading)
  'PROPOSED_FOR',          // (RetrofitProposal)-[:PROPOSED_FOR]->(Site|Building|Pit)
  'PROPOSAL_BASED_ON',     // (RetrofitProposal)-[:PROPOSAL_BASED_ON]->(UtilityReading|WorkOrder|OutageEvent)
] as const;

// ─── Timeline (cross-cutting) ────────────────────────────────────────────────

export const TIMELINE_RELATIONSHIPS = [
  'HAS_EVENT',             // (*)-[:HAS_EVENT]->(TimelineEvent) — anything can have timeline events
  'TRIGGERED_BY',          // (TimelineEvent)-[:TRIGGERED_BY]->(User|CounterpartyProfile)
] as const;

// ─── All relationships combined ──────────────────────────────────────────────

export const ALL_RELATIONSHIP_TYPES = [
  ...ORG_RELATIONSHIPS,
  ...SITE_HIERARCHY_RELATIONSHIPS,
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
