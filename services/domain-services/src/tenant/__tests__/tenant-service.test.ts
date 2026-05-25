/**
 * Unit tests for TenantService
 */

import { describe, it, expect, vi } from 'vitest';
import type { TenantId, UserId } from '@borjie/domain-models';
import {
  type Tenant,
  type CreateTenantInput,
  type UpdateTenantInput,
  asTenantId,
  asUserId,
} from '@borjie/domain-models';
import type { TenantRepository, OrganizationRepository, UnitOfWork } from '../../common/repository.js';
import type { EventBus } from '../../common/events.js';
import {
  TenantService,
  TenantServiceError,
} from '../tenant-service.js';

const defaultSettings = {
  maxUsers: 5,
  maxProperties: 10,
  maxUnits: 50,
  features: {} as any,
  branding: {} as any,
  notifications: {} as any,
};

function createMockTenant(overrides?: Partial<Tenant>): Tenant {
  return {
    id: asTenantId('tnt_test123'),
    slug: 'acme-properties',
    name: 'Acme Properties',
    status: 'active',
    subscriptionTier: 'starter',
    billingCycle: 'monthly',
    settings: defaultSettings,
    contactEmail: 'admin@acme.com',
    contactPhone: null,
    logoUrl: null,
    timezone: 'Africa/Nairobi',
    locale: 'en-KE',
    trialEndsAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    createdBy: asUserId('usr_1'),
    updatedBy: asUserId('usr_1'),
    deletedAt: null,
    deletedBy: null,
    ...overrides,
  };
}

function createMockUow(
  tenantRepo: Partial<TenantRepository>,
  orgRepo: Partial<OrganizationRepository>
): UnitOfWork {
  return {
    tenants: tenantRepo as TenantRepository,
    organizations: orgRepo as OrganizationRepository,
    users: {} as any,
    roles: {} as any,
    policies: {} as any,
    sessions: {} as any,
    auditEvents: {} as any,
    beginTransaction: vi.fn().mockResolvedValue({ id: 'tx1', commit: vi.fn(), rollback: vi.fn() }),
    executeInTransaction: vi.fn(async (fn) => fn()),
  };
}

function createMockEventBus(): EventBus {
  return {
    publish: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn().mockReturnValue(() => {}),
  };
}

describe('TenantService', () => {
  const tenantId = asTenantId('tnt_test123');
  const userId = asUserId('usr_1');
  const correlationId = 'corr_123';

  describe('createTenant', () => {
    it('creates a tenant successfully with valid input', async () => {
      const createInput: CreateTenantInput = {
        slug: 'acme-properties',
        name: 'Acme Properties',
        contactEmail: 'admin@acme.com',
      };

      const mockTenant = createMockTenant({ slug: 'acme-properties', name: 'Acme Properties' });
      const mockOrg = {
        id: 'org_1' as any,
        name: 'Acme Properties',
        code: 'ACME_PROPERTIES',
        type: 'root' as any,
        parentId: null,
        tenantId,
        depth: 0,
        path: ['org_1'] as any,
        contact: { email: 'admin@acme.com', phone: null, address: null },
        description: 'Root organization for Acme Properties',
        status: 'active' as any,
        createdAt: '',
        updatedAt: '',
        createdBy: userId,
        updatedBy: userId,
        deletedAt: null,
        deletedBy: null,
      };

      const tenantRepo = {
        findBySlug: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue(mockTenant),
      };

      const orgRepo = {
        create: vi.fn().mockResolvedValue(mockOrg),
      };

      const uow = createMockUow(tenantRepo, orgRepo);
      const eventBus = createMockEventBus();
      const service = new TenantService(uow, eventBus);

      const result = await service.createTenant(createInput, userId, correlationId);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.slug).toBe('acme-properties');
        expect(result.data.name).toBe('Acme Properties');
      }
      expect(tenantRepo.findBySlug).toHaveBeenCalledWith('acme-properties');
      expect(tenantRepo.create).toHaveBeenCalled();
      expect(orgRepo.create).toHaveBeenCalled();
      expect(eventBus.publish).toHaveBeenCalled();
    });

    it('returns validation error for invalid slug format', async () => {
      const createInput: CreateTenantInput = {
        slug: 'AB',
        name: 'Acme',
        contactEmail: 'admin@acme.com',
      };

      const tenantRepo = { findBySlug: vi.fn().mockResolvedValue(null) };
      const uow = createMockUow(tenantRepo, {});
      const eventBus = createMockEventBus();
      const service = new TenantService(uow, eventBus);

      const result = await service.createTenant(createInput, userId, correlationId);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(TenantServiceError.INVALID_SLUG);
        expect(result.error.message).toContain('Invalid tenant slug');
      }
      expect(tenantRepo.findBySlug).not.toHaveBeenCalled();
    });

    it('returns error when slug already exists (duplicate)', async () => {
      const createInput: CreateTenantInput = {
        slug: 'acme-properties',
        name: 'Acme Properties',
        contactEmail: 'admin@acme.com',
      };

      const existingTenant = createMockTenant();
      const tenantRepo = {
        findBySlug: vi.fn().mockResolvedValue(existingTenant),
      };

      const uow = createMockUow(tenantRepo, {});
      const eventBus = createMockEventBus();
      const service = new TenantService(uow, eventBus);

      const result = await service.createTenant(createInput, userId, correlationId);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(TenantServiceError.SLUG_EXISTS);
        expect(result.error.message).toContain('already exists');
      }
      expect(tenantRepo.findBySlug).toHaveBeenCalledWith('acme-properties');
    });
  });

  describe('updateTenant', () => {
    it('updates a tenant successfully', async () => {
      const existingTenant = createMockTenant();
      const updatedTenant = { ...existingTenant, name: 'Updated Name', updatedAt: new Date().toISOString() };

      const tenantRepo = {
        findById: vi.fn().mockResolvedValue(existingTenant),
        update: vi.fn().mockResolvedValue(updatedTenant),
      };

      const uow = createMockUow(tenantRepo, {});
      const eventBus = createMockEventBus();
      const service = new TenantService(uow, eventBus);

      const updateInput: UpdateTenantInput = { name: 'Updated Name' };
      const result = await service.updateTenant(tenantId, updateInput, userId, correlationId);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe('Updated Name');
      }
      expect(tenantRepo.findById).toHaveBeenCalledWith(tenantId);
      expect(tenantRepo.update).toHaveBeenCalled();
      expect(eventBus.publish).toHaveBeenCalled();
    });

    it('returns error when tenant not found', async () => {
      const tenantRepo = {
        findById: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
      };

      const uow = createMockUow(tenantRepo, {});
      const eventBus = createMockEventBus();
      const service = new TenantService(uow, eventBus);

      const result = await service.updateTenant(tenantId, { name: 'New Name' }, userId, correlationId);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(TenantServiceError.TENANT_NOT_FOUND);
        expect(result.error.message).toContain('not found');
      }
      expect(tenantRepo.update).not.toHaveBeenCalled();
    });

    it('does not publish event when no changes', async () => {
      const existingTenant = createMockTenant({ name: 'Same Name' });
      const tenantRepo = {
        findById: vi.fn().mockResolvedValue(existingTenant),
        update: vi.fn().mockResolvedValue({ ...existingTenant, name: 'Same Name' }),
      };

      const uow = createMockUow(tenantRepo, {});
      const eventBus = createMockEventBus();
      const service = new TenantService(uow, eventBus);

      const result = await service.updateTenant(tenantId, { name: 'Same Name' }, userId, correlationId);

      expect(result.success).toBe(true);
      expect(eventBus.publish).not.toHaveBeenCalled();
    });
  });

  describe('getTenant', () => {
    it('returns tenant when found', async () => {
      const mockTenant = createMockTenant();
      const tenantRepo = {
        findById: vi.fn().mockResolvedValue(mockTenant),
      };

      const uow = createMockUow(tenantRepo, {});
      const eventBus = createMockEventBus();
      const service = new TenantService(uow, eventBus);

      const result = await service.getTenant(tenantId);

      expect(result).toEqual(mockTenant);
      expect(tenantRepo.findById).toHaveBeenCalledWith(tenantId);
    });

    it('returns null when tenant not found', async () => {
      const tenantRepo = {
        findById: vi.fn().mockResolvedValue(null),
      };

      const uow = createMockUow(tenantRepo, {});
      const eventBus = createMockEventBus();
      const service = new TenantService(uow, eventBus);

      const result = await service.getTenant(tenantId);

      expect(result).toBeNull();
    });
  });
});
