/**
 * Organization Domain Model
 * 
 * Organizations represent hierarchical business units within a tenant.
 * They enable multi-level organizational structures (e.g., regional offices,
 * property management companies, departments).
 */

import type {
  TenantId,
  OrganizationId,
  UserId,
  EntityMetadata,
  SoftDeletable,
  TenantScoped,
} from '../common/types.js';

/** Organization status */
export const OrganizationStatus = {
  ACTIVE: 'ACTIVE',
  SUSPENDED: 'SUSPENDED',
  ARCHIVED: 'ARCHIVED',
} as const;

export type OrganizationStatus = (typeof OrganizationStatus)[keyof typeof OrganizationStatus];

/** Organization type classification */
export const OrganizationType = {
  /** Root organization (one per tenant) */
  ROOT: 'ROOT',
  /** Regional office or branch */
  REGION: 'REGION',
  /** Property management company */
  PROPERTY_COMPANY: 'PROPERTY_COMPANY',
  /** Department within an organization */
  DEPARTMENT: 'DEPARTMENT',
  /** Individual property or estate */
  PROPERTY: 'PROPERTY',
} as const;

export type OrganizationType = (typeof OrganizationType)[keyof typeof OrganizationType];

/** Organization contact information */
export interface OrganizationContact {
  readonly email: string;
  readonly phone: string | null;
  readonly address: OrganizationAddress | null;
}

/** Organization address */
export interface OrganizationAddress {
  readonly line1: string;
  readonly line2: string | null;
  readonly city: string;
  readonly state: string;
  readonly postalCode: string;
  readonly country: string;
}

/** Core Organization entity */
export interface Organization extends EntityMetadata, SoftDeletable, TenantScoped {
  readonly id: OrganizationId;
  /** Display name */
  readonly name: string;
  /** Unique code within the tenant (for reference) */
  readonly code: string;
  /** Organization type */
  readonly type: OrganizationType;
  /** Current status */
  readonly status: OrganizationStatus;
  /** Parent organization ID (null for root) */
  readonly parentId: OrganizationId | null;
  /** Full path of organization IDs from root (for efficient hierarchy queries) */
  readonly path: readonly OrganizationId[];
  /** Depth in the organization hierarchy (0 for root) */
  readonly depth: number;
  /** Contact information */
  readonly contact: OrganizationContact;
  /** Optional description */
  readonly description: string | null;
  /** Custom metadata for integrations */
  readonly metadata: Record<string, unknown>;
}

/** Input for creating an organization */
export interface CreateOrganizationInput {
  readonly name: string;
  readonly code: string;
  readonly type: OrganizationType;
  readonly parentId: OrganizationId | null;
  readonly contact: OrganizationContact;
  readonly description?: string;
  readonly metadata?: Record<string, unknown>;
}

/** Input for updating an organization */
export interface UpdateOrganizationInput {
  readonly name?: string;
  readonly status?: OrganizationStatus;
  readonly contact?: Partial<OrganizationContact>;
  readonly description?: string;
  readonly metadata?: Record<string, unknown>;
}

/** Organization with children count */
export interface OrganizationWithStats extends Organization {
  readonly childCount: number;
  readonly userCount: number;
  readonly propertyCount: number;
}

/** Validates organization code format */
export function isValidOrganizationCode(code: string): boolean {
  // 2-20 characters, uppercase alphanumeric with underscores
  const codeRegex = /^[A-Z0-9][A-Z0-9_]{0,18}[A-Z0-9]?$/;
  return codeRegex.test(code);
}

/** Check if organization is operational */
export function isOrganizationOperational(org: Organization): boolean {
  return org.status === OrganizationStatus.ACTIVE && org.deletedAt === null;
}

/** Check if org1 is ancestor of org2 */
export function isAncestorOf(ancestor: Organization, descendant: Organization): boolean {
  return descendant.path.includes(ancestor.id);
}

/** Check if org1 is descendant of org2 */
export function isDescendantOf(descendant: Organization, ancestor: Organization): boolean {
  return isAncestorOf(ancestor, descendant);
}

/** Get the root organization ID from an organization's path */
export function getRootOrganizationId(org: Organization): OrganizationId {
  return org.path[0] ?? org.id;
}
