/**
 * Common types and utilities shared across all domain models.
 */

// ============================================================================
// Base Entity Types
// ============================================================================

/**
 * All entities have these common fields for auditing and soft-delete.
 */
export interface BaseEntity {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date | null;
}

/**
 * Entities that belong to a tenant have this mixin.
 */
export interface TenantScoped {
  tenantId: string;
}

/**
 * Entities that support versioning for optimistic concurrency.
 */
export interface Versioned {
  version: number;
}

// ============================================================================
// Value Objects
// ============================================================================

/**
 * Represents a physical address.
 */
export interface Address {
  line1: string;
  line2?: string;
  city: string;
  county?: string;
  postalCode: string;
  country: string;
}

/**
 * Represents contact information.
 */
export interface ContactInfo {
  email?: string;
  phone?: string;
  alternativePhone?: string;
}

/**
 * Represents a monetary amount with currency.
 */
export interface Money {
  amount: number; // Stored as minor units (cents/pence)
  currency: Currency;
}

/**
 * @deprecated Use `CurrencyCode` from `./types` instead — it is typed
 * as `string` so all 140+ ISO-4217 codes are accepted, which is the
 * Phase-E "built for the world" stance. This 4-value union pinned the
 * platform to KES/USD/EUR/GBP and blocked TZS / NGN / RWF / UGX etc.
 *
 * Kept as an alias for backwards compatibility with legacy imports.
 */
export type Currency = string;

/**
 * Date range for time-bounded entities.
 */
export interface DateRange {
  startDate: Date;
  endDate: Date;
}

// ============================================================================
// Pagination
// ============================================================================

export interface PaginationParams {
  page: number;
  pageSize: number;
}

export interface PaginatedResult<T> {
  data: T[];
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
}

// ============================================================================
// Result Types
// ============================================================================

/**
 * Result type for operations that can fail.
 *
 * Provides dual-shape ergonomics: callers may destructure either
 *   - `{ success, data, error }` (legacy)
 *   - `{ ok, value, error }` (idiomatic Rust-style)
 *
 * Both are present on every instance so migrating a caller is a
 * rename-only change with no runtime wrapping required.
 */
export type Result<T, E = Error> =
  | { success: true; ok: true; data: T; value: T }
  | { success: false; ok: false; error: E };

export function ok<T>(data: T): Result<T, never> {
  return { success: true, ok: true, data, value: data };
}

export function err<E>(error: E): Result<never, E> {
  return { success: false, ok: false, error };
}

// ============================================================================
// Audit Types
// ============================================================================

export interface AuditEvent {
  id: string;
  tenantId: string;
  userId: string;
  action: string;
  entityType: string;
  entityId: string;
  changes?: Record<string, { from: unknown; to: unknown }>;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  timestamp: Date;
}
