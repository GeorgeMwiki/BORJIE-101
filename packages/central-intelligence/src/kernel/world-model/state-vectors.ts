/**
 * World-model state vectors — typed snapshots of the four entities the
 * brain reasons over: properties, tenants/leases, owners, and the
 * agency/tenant-org as a whole. Each vector is observed at a moment
 * in time; an ordered series of vectors becomes the input to the
 * trajectory forecaster.
 *
 * Mirrors LITFIN's `/src/core/credit-mind/world-model/` borrower-state
 * pattern, scoped to property management. The forecasting module is a
 * deterministic linear extrapolator + uncertainty bands. A learned
 * model (JEPA-style) can be swapped behind the same shapes later.
 *
 * All numeric "rate" fields live on [0, 1]; currency-denominated fields
 * carry an ISO-4217 code so downstream FX-normalisation can pick them
 * up. Vectors are immutable — never mutate; build a new object.
 */

// ─────────────────────────────────────────────────────────────────────
// PropertyState — a single property snapshot. The tenantId here is the
// SaaS-tenant (estate-management org) that owns the data, NOT the
// resident-tenant on a lease. (In this codebase "tenant" overloads
// both senses; the tenant-state vector below uses leaseId + tenantId
// for resident tenants.)
// ─────────────────────────────────────────────────────────────────────

export interface PropertyState {
  readonly propertyId: string;
  readonly tenantId: string;
  readonly observedAt: string;
  readonly vacancyRate: number;          // [0,1]
  readonly avgRentMajor: number;
  readonly currency: string;             // ISO-4217
  readonly arrearsRate: number;          // [0,1] of leases ≥30d late
  readonly maintenanceBacklog: number;   // count of open work-orders
  readonly renewalRate: number;          // [0,1] last 12 months
  readonly turnoverRate: number;         // [0,1] last 12 months
  readonly conditionScore: number;       // [0,1] inspection roll-up
}

// ─────────────────────────────────────────────────────────────────────
// TenantState — the state of one resident tenant on one lease. Used
// for arrears-trajectory + default-probability forecasting.
// ─────────────────────────────────────────────────────────────────────

export interface TenantState {
  readonly leaseId: string;
  readonly tenantId: string;
  readonly observedAt: string;
  readonly arrearsDays: number;          // current overdue
  readonly arrearsAmountMajor: number;
  readonly currency: string;
  readonly paymentRegularity: number;    // [0,1] last 12 payments on-time fraction
  readonly tenureMonths: number;
  readonly disputeCount: number;
  readonly maintenanceComplaintsLast90d: number;
}

// ─────────────────────────────────────────────────────────────────────
// OwnerState — portfolio-level view from the property-owner's seat.
// ─────────────────────────────────────────────────────────────────────

export interface OwnerState {
  readonly ownerId: string;
  readonly tenantId: string;
  readonly observedAt: string;
  readonly portfolioSizeUnits: number;
  readonly portfolioOccupancy: number;   // [0,1]
  readonly netCollectionRate: number;    // [0,1]
  readonly disbursementCadenceDays: number;
}

// ─────────────────────────────────────────────────────────────────────
// AgencyState — the estate-management agency / SaaS-tenant rolled up
// to a single vector. Drives market-regime detection.
// ─────────────────────────────────────────────────────────────────────

export interface AgencyState {
  readonly tenantId: string;
  readonly observedAt: string;
  readonly activeLeases: number;
  readonly activeWorkOrders: number;
  readonly aiCostMajorLast30d: number;
  readonly currency: string;
  readonly stafCount: number;
  readonly automationFraction: number;   // [0,1] tasks the AI completed without human approval
}
