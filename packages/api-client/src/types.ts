/**
 * API Client Types - BORJIE
 *
 * Comprehensive type definitions for API interactions
 */

// ============================================================================
// Response Types
// ============================================================================

/** Standard API response wrapper */
export interface ApiResponse<T> {
  success: boolean;
  data: T;
  pagination?: PaginationInfo;
  meta?: ResponseMeta;
}

/** API error response */
export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown> | Array<Record<string, unknown>>;
  requestId?: string;
  timestamp?: string;
  path?: string;
}

/** Response metadata */
export interface ResponseMeta {
  requestId?: string;
  timestamp?: string;
  processingTime?: number;
  version?: string;
}

// ============================================================================
// Pagination Types
// ============================================================================

/** Pagination metadata returned from list endpoints */
export interface PaginationInfo {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

/** Base params for paginated list endpoints */
export interface PaginationParams {
  page?: number;
  pageSize?: number;
}

/** Paginated response */
export interface PaginatedResponse<T> {
  data: T[];
  pagination: PaginationInfo;
}

/** Sort direction for list endpoints */
export type SortOrder = 'asc' | 'desc';

/** Sort parameters */
export interface SortParams {
  sortBy?: string;
  sortOrder?: SortOrder;
}

/** Combined list params */
export interface ListParams extends PaginationParams, SortParams {
  search?: string;
  filter?: Record<string, string | string[]>;
}

// ============================================================================
// Configuration Types
// ============================================================================

/** API client configuration */
export interface ApiClientConfig {
  /** Base URL for API requests */
  baseUrl: string;
  /** Tenant ID for multi-tenant requests */
  tenantId?: string;
  /** Access token for authentication */
  accessToken?: string;
  /** Refresh token for token refresh */
  refreshToken?: string;
  /** Request timeout in milliseconds */
  timeout?: number;
  /** Number of retry attempts */
  retries?: number;
  /** Base retry delay in milliseconds */
  retryDelay?: number;
  /** Custom headers */
  headers?: Record<string, string>;
  /** Token refresh callback */
  onTokenRefresh?: RefreshTokenFn;
  /** Auth error callback (e.g., logout) */
  onAuthError?: () => void;
}

/** Request configuration */
export interface RequestConfig {
  /** Skip authentication */
  skipAuth?: boolean;
  /** Request timeout override */
  timeout?: number;
  /** Retry count override */
  retries?: number;
  /** Retry delay override */
  retryDelay?: number;
  /** Query parameters */
  params?: Record<string, string | number | boolean | string[] | undefined>;
}

// ============================================================================
// Authentication Types
// ============================================================================

/** Token pair from auth endpoints */
export interface TokenPair {
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
  tokenType?: string;
}

/** Token refresh function type */
export type RefreshTokenFn = (refreshToken: string) => Promise<TokenPair>;

/** Auth context for requests */
export interface AuthContext {
  userId: string;
  tenantId: string;
  role: string;
  permissions: string[];
  propertyAccess: string[];
  email?: string;
}

// ============================================================================
// Entity Types
// ============================================================================

/** Base entity with common fields */
export interface BaseEntity {
  id: string;
  createdAt: string;
  updatedAt: string;
}

/** Soft-deletable entity */
export interface SoftDeletableEntity extends BaseEntity {
  deletedAt?: string | null;
}

/** Tenant-scoped entity */
export interface TenantScopedEntity extends BaseEntity {
  tenantId: string;
}

/** Auditable entity */
export interface AuditableEntity extends TenantScopedEntity {
  createdBy?: string;
  updatedBy?: string;
}

// ============================================================================
// Common Data Types
// ============================================================================

/** Address structure */
export interface Address {
  street: string;
  city: string;
  state?: string;
  postalCode?: string;
  country: string;
  latitude?: number;
  longitude?: number;
}

/** Contact information */
export interface ContactInfo {
  email?: string;
  phone?: string;
  alternativePhone?: string;
}

/** Money amount with currency */
export interface Money {
  amount: number;
  currency: string;
}

/** Date range */
export interface DateRange {
  start: string;
  end: string;
}

/** File attachment */
export interface Attachment {
  id: string;
  name: string;
  url: string;
  mimeType: string;
  size: number;
  uploadedAt: string;
}

// ============================================================================
// Filter Types
// ============================================================================

/** Date filter operators */
export interface DateFilter {
  equals?: string;
  before?: string;
  after?: string;
  between?: DateRange;
}

/** Number filter operators */
export interface NumberFilter {
  equals?: number;
  gt?: number;
  gte?: number;
  lt?: number;
  lte?: number;
  between?: [number, number];
}

/** String filter operators */
export interface StringFilter {
  equals?: string;
  contains?: string;
  startsWith?: string;
  endsWith?: string;
  in?: string[];
}

// ============================================================================
// Status Types
// ============================================================================

/** Generic status */
export type Status = 'active' | 'inactive' | 'pending' | 'archived';

/** Approval status */
export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

/** Payment status */
export type PaymentStatus = 'pending' | 'completed' | 'failed' | 'refunded' | 'cancelled';

/** Work order status */
export type WorkOrderStatus =
  | 'open'
  | 'assigned'
  | 'in_progress'
  | 'on_hold'
  | 'completed'
  | 'cancelled';

/** Lease status */
export type LeaseStatus = 'draft' | 'active' | 'expired' | 'terminated' | 'renewed';

// ============================================================================
// Utility Functions
// ============================================================================

/** Build query params from an object, omitting undefined/null values */
export function buildQueryParams(
  params: Record<string, string | number | boolean | string[] | undefined | null>
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      if (value.length > 0) result[key] = value.join(',');
    } else {
      result[key] = String(value);
    }
  }
  return result;
}

/** Build sort query string */
export function buildSortQuery(sortBy?: string, sortOrder?: SortOrder): string {
  if (!sortBy) return '';
  return `${sortOrder === 'desc' ? '-' : ''}${sortBy}`;
}

/** Parse API date string to Date object */
export function parseApiDate(dateString: string): Date {
  return new Date(dateString);
}

/** Format date for API */
export function formatApiDate(date: Date): string {
  return date.toISOString();
}

/** Check if response is paginated */
export function isPaginatedResponse<T>(
  response: ApiResponse<T> | PaginatedResponse<T>
): response is PaginatedResponse<T> {
  return 'pagination' in response && response.pagination !== undefined;
}

/** Extract error message from API error */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'object' && error !== null) {
    const apiError = error as ApiError;
    return apiError.message || 'An unexpected error occurred';
  }
  return String(error);
}
