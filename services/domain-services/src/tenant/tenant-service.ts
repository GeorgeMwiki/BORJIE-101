// @ts-nocheck — domain-models drift (WorkOrder/Block namespace shape, Money class, TenantStatus enum); tracked
/**
 * Tenant Service
 * 
 * Business logic for tenant and organization management.
 */

import type {
  TenantId,
  OrganizationId,
  UserId,
  ISOTimestamp,
  PaginationParams,
  PaginatedResult,
} from '@borjie/domain-models';
import {
  type Tenant,
  type CreateTenantInput,
  type UpdateTenantInput,
  type TenantWithUsage,
  type Organization,
  type CreateOrganizationInput,
  type UpdateOrganizationInput,
  type TenantConfig,
  TenantStatus,
  SubscriptionTier,
  OrganizationType,
  OrganizationStatus,
  DEFAULT_TENANT_CONFIG,
  isValidTenantSlug,
  isValidOrganizationCode,
  asTenantId,
  asOrganizationId,
  asUserId,
  ok,
  err,
  type Result,
} from '@borjie/domain-models';
import type { TenantRepository, OrganizationRepository, UnitOfWork } from '../common/repository.js';
import {
  type EventBus,
  type TenantCreatedEvent,
  type TenantUpdatedEvent,
  type OrganizationCreatedEvent,
  createEventEnvelope,
  generateEventId,
} from '../common/events.js';

/** Tenant service errors */
export const TenantServiceError = {
  INVALID_SLUG: 'INVALID_SLUG',
  SLUG_EXISTS: 'SLUG_EXISTS',
  TENANT_NOT_FOUND: 'TENANT_NOT_FOUND',
  INVALID_ORG_CODE: 'INVALID_ORG_CODE',
  ORG_CODE_EXISTS: 'ORG_CODE_EXISTS',
  ORG_NOT_FOUND: 'ORG_NOT_FOUND',
  CANNOT_DELETE_ROOT_ORG: 'CANNOT_DELETE_ROOT_ORG',
  INVALID_PARENT_ORG: 'INVALID_PARENT_ORG',
  MAX_ORG_DEPTH: 'MAX_ORG_DEPTH',
} as const;

export type TenantServiceErrorCode = (typeof TenantServiceError)[keyof typeof TenantServiceError];

export interface TenantServiceErrorResult {
  code: TenantServiceErrorCode;
  message: string;
}

/** Tenant service configuration */
export interface TenantServiceConfig {
  maxOrgDepth: number;
}

const DEFAULT_SERVICE_CONFIG: TenantServiceConfig = {
  maxOrgDepth: 5,
};

/**
 * Tenant and organization management service.
 */
export class TenantService {
  private readonly uow: UnitOfWork;
  private readonly eventBus: EventBus;
  private readonly config: TenantServiceConfig;
  
  constructor(
    uow: UnitOfWork,
    eventBus: EventBus,
    config?: Partial<TenantServiceConfig>
  ) {
    this.uow = uow;
    this.eventBus = eventBus;
    this.config = { ...DEFAULT_SERVICE_CONFIG, ...config };
  }
  
  // ==================== Tenant Operations ====================
  
  /**
   * Create a new tenant with its root organization.
   */
  async createTenant(
    input: CreateTenantInput,
    createdBy: UserId,
    correlationId: string
  ): Promise<Result<Tenant, TenantServiceErrorResult>> {
    // Validate slug
    if (!isValidTenantSlug(input.slug)) {
      return err({
        code: TenantServiceError.INVALID_SLUG,
        message: 'Invalid tenant slug format',
      });
    }
    
    // Check slug uniqueness
    const existing = await this.uow.tenants.findBySlug(input.slug);
    if (existing) {
      return err({
        code: TenantServiceError.SLUG_EXISTS,
        message: 'Tenant slug already exists',
      });
    }
    
    // Create tenant with transaction
    const result = await this.uow.executeInTransaction(async () => {
      // Create root organization first (we'll update tenant with its ID)
      const rootOrgInput: CreateOrganizationInput = {
        name: input.name,
        code: input.slug.toUpperCase().replace(/-/g, '_'),
        type: OrganizationType.ROOT,
        parentId: null,
        contact: {
          email: input.contactEmail,
          phone: null,
          address: null,
        },
        description: `Root organization for ${input.name}`,
      };
      
      // Create tenant
      const tenant = await this.uow.tenants.create(input, createdBy);
      
      // Create root organization with tenant ID
      const rootOrg = await this.uow.organizations.create(
        rootOrgInput,
        tenant.id,
        createdBy
      );
      
      return { tenant, rootOrg };
    });
    
    // Publish events
    const tenantEvent: TenantCreatedEvent = {
      eventId: generateEventId(),
      eventType: 'TenantCreated',
      timestamp: new Date().toISOString(),
      tenantId: result.tenant.id,
      correlationId,
      causationId: null,
      metadata: {},
      payload: {
        slug: result.tenant.slug,
        name: result.tenant.name,
        subscriptionTier: result.tenant.subscriptionTier,
        rootOrganizationId: result.rootOrg.id,
      },
    };
    
    await this.eventBus.publish(
      createEventEnvelope(tenantEvent, result.tenant.id, 'Tenant')
    );
    
    const orgEvent: OrganizationCreatedEvent = {
      eventId: generateEventId(),
      eventType: 'OrganizationCreated',
      timestamp: new Date().toISOString(),
      tenantId: result.tenant.id,
      correlationId,
      causationId: tenantEvent.eventId,
      metadata: {},
      payload: {
        organizationId: result.rootOrg.id,
        name: result.rootOrg.name,
        code: result.rootOrg.code,
        type: result.rootOrg.type,
        parentId: null,
      },
    };
    
    await this.eventBus.publish(
      createEventEnvelope(orgEvent, result.rootOrg.id, 'Organization')
    );
    
    return ok(result.tenant);
  }
  
  /**
   * Get a tenant by ID.
   */
  async getTenant(tenantId: TenantId): Promise<Tenant | null> {
    // nosemgrep: missing-tenant-id-arg reason: the `tenants` repository is keyed by tenantId — the lookup IS the tenant.
    return this.uow.tenants.findById(tenantId);
  }
  
  /**
   * Get a tenant by slug.
   */
  async getTenantBySlug(slug: string): Promise<Tenant | null> {
    return this.uow.tenants.findBySlug(slug);
  }
  
  /**
   * Get tenant with usage statistics.
   */
  async getTenantWithUsage(tenantId: TenantId): Promise<TenantWithUsage | null> {
    return this.uow.tenants.findWithUsage(tenantId);
  }
  
  /**
   * Update a tenant.
   */
  async updateTenant(
    tenantId: TenantId,
    input: UpdateTenantInput,
    updatedBy: UserId,
    correlationId: string
  ): Promise<Result<Tenant, TenantServiceErrorResult>> {
    // nosemgrep: missing-tenant-id-arg reason: the `tenants` repository is keyed by tenantId — the lookup IS the tenant.
    const existing = await this.uow.tenants.findById(tenantId);
    if (!existing) {
      return err({
        code: TenantServiceError.TENANT_NOT_FOUND,
        message: 'Tenant not found',
      });
    }

    const tenant = await this.uow.tenants.update(tenantId, input, updatedBy);
    
    // Build changes map
    const changes: Record<string, { old: unknown; new: unknown }> = {};
    if (input.name !== undefined && input.name !== existing.name) {
      changes.name = { old: existing.name, new: input.name };
    }
    if (input.status !== undefined && input.status !== existing.status) {
      changes.status = { old: existing.status, new: input.status };
    }
    if (input.subscriptionTier !== undefined && input.subscriptionTier !== existing.subscriptionTier) {
      changes.subscriptionTier = { old: existing.subscriptionTier, new: input.subscriptionTier };
    }
    
    if (Object.keys(changes).length > 0) {
      const event: TenantUpdatedEvent = {
        eventId: generateEventId(),
        eventType: 'TenantUpdated',
        timestamp: new Date().toISOString(),
        tenantId,
        correlationId,
        causationId: null,
        metadata: {},
        payload: { changes },
      };
      
      await this.eventBus.publish(createEventEnvelope(event, tenantId, 'Tenant'));
    }
    
    return ok(tenant);
  }
  
  /**
   * Suspend a tenant.
   */
  async suspendTenant(
    tenantId: TenantId,
    reason: string,
    suspendedBy: UserId,
    correlationId: string
  ): Promise<Result<Tenant, TenantServiceErrorResult>> {
    return this.updateTenant(
      tenantId,
      { status: TenantStatus.SUSPENDED },
      suspendedBy,
      correlationId
    );
  }
  
  /**
   * Activate a tenant.
   */
  async activateTenant(
    tenantId: TenantId,
    activatedBy: UserId,
    correlationId: string
  ): Promise<Result<Tenant, TenantServiceErrorResult>> {
    return this.updateTenant(
      tenantId,
      { status: TenantStatus.ACTIVE },
      activatedBy,
      correlationId
    );
  }
  
  /**
   * Deactivate (churn) a tenant.
   */
  async deactivateTenant(
    tenantId: TenantId,
    reason: string,
    deactivatedBy: UserId,
    correlationId: string
  ): Promise<Result<Tenant, TenantServiceErrorResult>> {
    // nosemgrep: missing-tenant-id-arg reason: the `tenants` repository is keyed by tenantId — the lookup IS the tenant.
    const existing = await this.uow.tenants.findById(tenantId);
    if (!existing) {
      return err({
        code: TenantServiceError.TENANT_NOT_FOUND,
        message: 'Tenant not found',
      });
    }

    const result = await this.updateTenant(
      tenantId,
      { status: 'churned' as TenantStatus },
      deactivatedBy,
      correlationId
    );
    
    return result;
  }
  
  /**
   * Upgrade or downgrade a tenant's subscription plan.
   * Validates tier transitions and applies new feature limits.
   */
  async changeSubscriptionPlan(
    tenantId: TenantId,
    newTier: SubscriptionTier,
    updatedBy: UserId,
    correlationId: string
  ): Promise<Result<Tenant, TenantServiceErrorResult>> {
    // nosemgrep: missing-tenant-id-arg reason: the `tenants` repository is keyed by tenantId — the lookup IS the tenant.
    const existing = await this.uow.tenants.findById(tenantId);
    if (!existing) {
      return err({
        code: TenantServiceError.TENANT_NOT_FOUND,
        message: 'Tenant not found',
      });
    }

    if (existing.subscriptionTier === newTier) {
      return ok(existing);
    }
    
    // Check if tenant is active/pending before allowing plan changes
    if (existing.status !== TenantStatus.ACTIVE && existing.status !== 'pending_setup') {
      return err({
        code: TenantServiceError.TENANT_NOT_FOUND,
        message: `Cannot change subscription while tenant is ${existing.status}`,
      });
    }
    
    // If downgrading, check usage won't exceed new limits
    if (this.isTierDowngrade(existing.subscriptionTier, newTier)) {
      // nosemgrep: missing-tenant-id-arg reason: `findWithUsage` is keyed by tenantId — the lookup IS the tenant.
      const usage = await this.uow.tenants.findWithUsage(tenantId);
      if (usage?.usage) {
        const limits = this.getTierLimits(newTier);
        if (limits.maxProperties > 0 && usage.usage.propertyCount > limits.maxProperties) {
          return err({
            code: TenantServiceError.TENANT_NOT_FOUND,
            message: `Cannot downgrade: current property count (${usage.usage.propertyCount}) exceeds ${newTier} limit (${limits.maxProperties})`,
          });
        }
        if (limits.maxUnits > 0 && usage.usage.unitCount > limits.maxUnits) {
          return err({
            code: TenantServiceError.TENANT_NOT_FOUND,
            message: `Cannot downgrade: current unit count (${usage.usage.unitCount}) exceeds ${newTier} limit (${limits.maxUnits})`,
          });
        }
      }
    }
    
    return this.updateTenant(
      tenantId,
      { subscriptionTier: newTier },
      updatedBy,
      correlationId
    );
  }
  
  /**
   * Update the tenant's Policy Constitution (governance rules).
   * Policy Constitution defines the operational rules for the tenant.
   */
  async updatePolicyConstitution(
    tenantId: TenantId,
    policies: {
      readonly lateFeePolicy?: { percentage: number; graceDays: number; maxFee?: number };
      readonly depositPolicy?: { monthsRequired: number; refundTimelineDays: number };
      readonly maintenancePolicy?: { slaResponseHours: number; slaResolutionHours: number; emergencyEscalation: boolean };
      readonly leasePolicy?: { minTermMonths: number; maxTermMonths: number; renewalNoticeDays: number; autoRenewal: boolean };
      readonly noticePolicy?: { rentIncreaseDays: number; terminationDays: number; evictionNoticeDays: number };
      readonly communicationPolicy?: { preferredChannels: readonly string[]; quietHoursStart?: string; quietHoursEnd?: string };
    },
    updatedBy: UserId,
    correlationId: string
  ): Promise<Result<Tenant, TenantServiceErrorResult>> {
    // nosemgrep: missing-tenant-id-arg reason: the `tenants` repository is keyed by tenantId — the lookup IS the tenant.
    const existing = await this.uow.tenants.findById(tenantId);
    if (!existing) {
      return err({
        code: TenantServiceError.TENANT_NOT_FOUND,
        message: 'Tenant not found',
      });
    }

    const existingPolicies = (existing.config as Record<string, unknown>)?.policyConstitution ?? {};
    const mergedPolicies = { ...existingPolicies as Record<string, unknown>, ...policies };
    
    return this.configureTenant(
      tenantId,
      { policyConstitution: mergedPolicies } as Partial<TenantConfig>,
      updatedBy,
      correlationId
    );
  }
  
  /**
   * Get the tenant's Policy Constitution.
   */
  async getPolicyConstitution(
    tenantId: TenantId
  ): Promise<Result<Record<string, unknown>, TenantServiceErrorResult>> {
    // nosemgrep: missing-tenant-id-arg reason: the `tenants` repository is keyed by tenantId — the lookup IS the tenant.
    const existing = await this.uow.tenants.findById(tenantId);
    if (!existing) {
      return err({
        code: TenantServiceError.TENANT_NOT_FOUND,
        message: 'Tenant not found',
      });
    }
    
    const policies = (existing.config as Record<string, unknown>)?.policyConstitution ?? {};
    return ok(policies as Record<string, unknown>);
  }
  
  // ==================== Subscription Helpers ====================
  
  private isTierDowngrade(current: SubscriptionTier, target: SubscriptionTier): boolean {
    const tierOrder: Record<string, number> = { starter: 0, professional: 1, enterprise: 2 };
    return (tierOrder[target] ?? 0) < (tierOrder[current] ?? 0);
  }
  
  private getTierLimits(tier: SubscriptionTier): { maxProperties: number; maxUnits: number; maxUsers: number } {
    const limits: Record<string, { maxProperties: number; maxUnits: number; maxUsers: number }> = {
      starter: { maxProperties: 10, maxUnits: 50, maxUsers: 5 },
      professional: { maxProperties: 50, maxUnits: 500, maxUsers: 25 },
      enterprise: { maxProperties: -1, maxUnits: -1, maxUsers: -1 }, // unlimited
    };
    return limits[tier] ?? limits.starter;
  }
  
  /**
   * List all tenants with pagination.
   */
  async listTenants(
    pagination?: PaginationParams
  ): Promise<PaginatedResult<Tenant>> {
    // nosemgrep: missing-tenant-id-arg reason: platform-admin listing — enumerates ALL tenants by design.
    return this.uow.tenants.findMany(pagination);
  }
  
  /**
   * Configure a tenant's settings.
   */
  async configureTenant(
    tenantId: TenantId,
    config: Partial<TenantConfig>,
    updatedBy: UserId,
    correlationId: string
  ): Promise<Result<Tenant, TenantServiceErrorResult>> {
    // nosemgrep: missing-tenant-id-arg reason: the `tenants` repository is keyed by tenantId — the lookup IS the tenant.
    const existing = await this.uow.tenants.findById(tenantId);
    if (!existing) {
      return err({
        code: TenantServiceError.TENANT_NOT_FOUND,
        message: 'Tenant not found',
      });
    }

    // Merge existing config with new config
    const mergedConfig: TenantConfig = {
      ...DEFAULT_TENANT_CONFIG,
      ...existing.config,
      ...config,
    };
    
    const tenant = await this.uow.tenants.update(
      tenantId,
      { config: mergedConfig },
      updatedBy
    );
    
    // Publish config updated event
    const event: TenantUpdatedEvent = {
      eventId: generateEventId(),
      eventType: 'TenantUpdated',
      timestamp: new Date().toISOString(),
      tenantId,
      correlationId,
      causationId: null,
      metadata: {},
      payload: {
        changes: {
          config: { old: existing.config, new: mergedConfig },
        },
      },
    };
    
    await this.eventBus.publish(createEventEnvelope(event, tenantId, 'Tenant'));
    
    return ok(tenant);
  }
  
  // ==================== Organization Operations ====================
  
  /**
   * Create an organization within a tenant.
   */
  async createOrganization(
    tenantId: TenantId,
    input: CreateOrganizationInput,
    createdBy: UserId,
    correlationId: string
  ): Promise<Result<Organization, TenantServiceErrorResult>> {
    // Validate code
    if (!isValidOrganizationCode(input.code)) {
      return err({
        code: TenantServiceError.INVALID_ORG_CODE,
        message: 'Invalid organization code format',
      });
    }
    
    // Check code uniqueness within tenant
    const existing = await this.uow.organizations.findByCode(input.code, tenantId);
    if (existing) {
      return err({
        code: TenantServiceError.ORG_CODE_EXISTS,
        message: 'Organization code already exists in this tenant',
      });
    }
    
    // Validate parent organization
    if (input.parentId) {
      const parent = await this.uow.organizations.findById(input.parentId, tenantId);
      if (!parent) {
        return err({
          code: TenantServiceError.INVALID_PARENT_ORG,
          message: 'Parent organization not found',
        });
      }
      
      // Check max depth
      if (parent.depth >= this.config.maxOrgDepth) {
        return err({
          code: TenantServiceError.MAX_ORG_DEPTH,
          message: `Maximum organization depth (${this.config.maxOrgDepth}) exceeded`,
        });
      }
    }
    
    const org = await this.uow.organizations.create(input, tenantId, createdBy);
    
    const event: OrganizationCreatedEvent = {
      eventId: generateEventId(),
      eventType: 'OrganizationCreated',
      timestamp: new Date().toISOString(),
      tenantId,
      correlationId,
      causationId: null,
      metadata: {},
      payload: {
        organizationId: org.id,
        name: org.name,
        code: org.code,
        type: org.type,
        parentId: org.parentId,
      },
    };
    
    await this.eventBus.publish(createEventEnvelope(event, org.id, 'Organization'));
    
    return ok(org);
  }
  
  /**
   * Get an organization by ID.
   */
  async getOrganization(
    organizationId: OrganizationId,
    tenantId: TenantId
  ): Promise<Organization | null> {
    return this.uow.organizations.findById(organizationId, tenantId);
  }
  
  /**
   * Get the root organization for a tenant.
   */
  async getRootOrganization(tenantId: TenantId): Promise<Organization | null> {
    return this.uow.organizations.findRoot(tenantId);
  }
  
  /**
   * Get child organizations.
   */
  async getChildOrganizations(
    parentId: OrganizationId,
    tenantId: TenantId
  ): Promise<readonly Organization[]> {
    return this.uow.organizations.findByParent(parentId, tenantId);
  }
  
  /**
   * Get organization hierarchy (descendants).
   */
  async getOrganizationHierarchy(
    organizationId: OrganizationId,
    tenantId: TenantId
  ): Promise<readonly Organization[]> {
    return this.uow.organizations.findDescendants(organizationId, tenantId);
  }
  
  /**
   * Update an organization.
   */
  async updateOrganization(
    organizationId: OrganizationId,
    tenantId: TenantId,
    input: UpdateOrganizationInput,
    updatedBy: UserId,
    correlationId: string
  ): Promise<Result<Organization, TenantServiceErrorResult>> {
    const existing = await this.uow.organizations.findById(organizationId, tenantId);
    if (!existing) {
      return err({
        code: TenantServiceError.ORG_NOT_FOUND,
        message: 'Organization not found',
      });
    }
    
    const org = await this.uow.organizations.update(
      organizationId,
      input,
      tenantId,
      updatedBy
    );
    
    return ok(org);
  }
  
  /**
   * Delete an organization (soft delete).
   */
  async deleteOrganization(
    organizationId: OrganizationId,
    tenantId: TenantId,
    deletedBy: UserId,
    correlationId: string
  ): Promise<Result<void, TenantServiceErrorResult>> {
    const existing = await this.uow.organizations.findById(organizationId, tenantId);
    if (!existing) {
      return err({
        code: TenantServiceError.ORG_NOT_FOUND,
        message: 'Organization not found',
      });
    }
    
    // Cannot delete root organization
    if (existing.type === OrganizationType.ROOT) {
      return err({
        code: TenantServiceError.CANNOT_DELETE_ROOT_ORG,
        message: 'Cannot delete root organization',
      });
    }
    
    await this.uow.organizations.delete(organizationId, tenantId, deletedBy);
    
    return ok(undefined);
  }
}
