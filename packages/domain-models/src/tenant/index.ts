/**
 * Tenant domain models.
 *
 * Tenants represent organizations (property management companies, landlords)
 * that use the BORJIE platform. All data is scoped to tenants for isolation.
 */

import { BaseEntity, ContactInfo, Address } from '../common';

// ============================================================================
// Tenant Entity
// ============================================================================

export interface Tenant extends BaseEntity {
  name: string;
  slug: string; // URL-friendly identifier
  status: TenantStatus;
  plan: TenantPlan;
  settings: TenantSettings;
  billingInfo?: TenantBillingInfo;
  metadata?: Record<string, unknown>;
}

export type TenantStatus = 'active' | 'suspended' | 'pending' | 'cancelled';

export type TenantPlan = 'starter' | 'professional' | 'enterprise';

export interface TenantSettings {
  timezone: string;
  locale: string;
  currency: string;
  features: TenantFeatureFlags;
}

export interface TenantFeatureFlags {
  maintenanceModule: boolean;
  paymentProcessing: boolean;
  documentEsign: boolean;
  analyticsAdvanced: boolean;
  apiAccess: boolean;
  customBranding: boolean;
}

export interface TenantBillingInfo {
  billingEmail: string;
  billingAddress?: Address;
  taxId?: string;
  paymentMethodId?: string;
}

// ============================================================================
// User Entity
// ============================================================================

export interface User extends BaseEntity {
  tenantId: string;
  email: string;
  emailVerified: boolean;
  firstName: string;
  lastName: string;
  avatarUrl?: string;
  status: UserStatus;
  roles: UserRole[];
  contactInfo?: ContactInfo;
  preferences: UserPreferences;
  lastLoginAt?: Date;
  mfaEnabled: boolean;
}

export type UserStatus = 'active' | 'inactive' | 'pending' | 'locked';

export interface UserRole {
  roleId: string;
  roleName: string;
  assignedAt: Date;
  assignedBy: string;
}

export interface UserPreferences {
  notifications: NotificationPreferences;
  theme: 'light' | 'dark' | 'system';
  language: string;
}

export interface NotificationPreferences {
  email: boolean;
  sms: boolean;
  push: boolean;
  digest: 'immediate' | 'daily' | 'weekly' | 'none';
}

// ============================================================================
// Role Entity (RBAC)
// ============================================================================

export interface Role extends BaseEntity {
  tenantId: string;
  name: string;
  description?: string;
  isSystem: boolean; // System roles cannot be deleted
  permissions: Permission[];
}

export interface Permission {
  resource: string;
  actions: PermissionAction[];
  conditions?: PermissionCondition[];
}

export type PermissionAction = 'create' | 'read' | 'update' | 'delete' | 'manage';

export interface PermissionCondition {
  field: string;
  operator: 'eq' | 'neq' | 'in' | 'nin' | 'contains';
  value: unknown;
}

// ============================================================================
// Invitation Entity
// ============================================================================

export interface Invitation extends BaseEntity {
  tenantId: string;
  email: string;
  roleIds: string[];
  invitedBy: string;
  status: InvitationStatus;
  expiresAt: Date;
  acceptedAt?: Date;
}

export type InvitationStatus = 'pending' | 'accepted' | 'expired' | 'revoked';

// ============================================================================
// DTOs
// ============================================================================

export interface CreateTenantInput {
  name: string;
  slug?: string;
  plan: TenantPlan;
  adminEmail: string;
  adminFirstName: string;
  adminLastName: string;
}

export interface UpdateTenantInput {
  name?: string;
  settings?: Partial<TenantSettings>;
  billingInfo?: Partial<TenantBillingInfo>;
}

export interface CreateUserInput {
  email: string;
  firstName: string;
  lastName: string;
  roleIds: string[];
}

export interface UpdateUserInput {
  firstName?: string;
  lastName?: string;
  contactInfo?: Partial<ContactInfo>;
  preferences?: Partial<UserPreferences>;
}
