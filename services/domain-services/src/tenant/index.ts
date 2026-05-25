/**
 * Tenant domain service.
 *
 * Handles SaaS tenant/organization management, tenant lifecycle,
 * configuration, and subscription management.
 * 
 * Key methods:
 * - create: Create a new tenant with root organization
 * - update: Update tenant details
 * - getPolicyConstitution: Get tenant's governance rules
 */

// Re-export the working TenantService implementation
export { TenantService, TenantServiceError, type TenantServiceErrorResult, type TenantServiceConfig } from './tenant-service.js';

// Re-export types from domain-models for convenience
export type {
  Tenant,
  TenantWithUsage,
  TenantConfig,
  Organization,
  CreateTenantInput,
  UpdateTenantInput,
  CreateOrganizationInput,
  UpdateOrganizationInput,
} from '@borjie/domain-models';

export type { TenantStatus, SubscriptionTier, OrganizationType, OrganizationStatus } from '@borjie/domain-models';
