/**
 * Unit tests for SiteService
 */

import { describe, it, expect, vi } from 'vitest';
import type { TenantId } from '@borjie/domain-models';
import {
  type MiningSite,
  type MiningUnit,
  money,
  asMiningSiteId,
  asMiningUnitId,
  asUserId,
} from '@borjie/domain-models';
import type { SiteRepository, UnitRepository } from '../index.js';
import type { EventBus } from '../../common/events.js';
import {
  SiteService,
  SiteServiceError,
  type CreateSiteInput,
  type UpdateSiteInput,
  type CreateUnitInput,
} from '../index.js';

function createMockEventBus(): EventBus {
  return {
    publish: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn().mockReturnValue(() => {}),
  };
}

describe('SiteService', () => {
  const tenantId = 'tnt_test' as TenantId;
  const userId = asUserId('usr_1');
  const correlationId = 'corr_123';

  describe('createSite', () => {
    it('creates a site successfully with valid input', async () => {
      const createInput: CreateSiteInput = {
        name: 'Geita Gold Site',
        type: 'open_pit',
        ownerId: 'owner_1' as any,
        address: {
          street: '123 Mine Rd',
          city: 'Geita',
          county: 'Geita',
          postalCode: '00100',
          country: 'Tanzania',
          latitude: null,
          longitude: null,
        },
      };

      const mockSite = {
        id: asMiningSiteId('site_1'),
        tenantId,
        name: 'Geita Gold Site',
        code: 'SITE-2025-0001',
        type: 'open_pit',
        status: 'active',
        ownerId: 'owner_1' as any,
        address: createInput.address,
        totalUnits: 0,
        activeUnits: 0,
        idleUnits: 0,
        createdAt: '',
        updatedAt: '',
        createdBy: userId,
        updatedBy: userId,
      };

      const siteRepo: Partial<SiteRepository> = {
        findByCode: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockImplementation((s) => Promise.resolve({ ...s, ...mockSite })),
        getNextSequence: vi.fn().mockResolvedValue(1),
      };

      const unitRepo: Partial<UnitRepository> = {};
      const eventBus = createMockEventBus();
      const service = new SiteService(
        siteRepo as SiteRepository,
        unitRepo as UnitRepository,
        eventBus
      );

      const result = await service.createSite(tenantId, createInput, userId, correlationId);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe('Geita Gold Site');
        expect(result.data.code).toBeDefined();
      }
      expect(siteRepo.findByCode).toHaveBeenCalled();
      expect(siteRepo.create).toHaveBeenCalled();
      expect(eventBus.publish).toHaveBeenCalled();
    });

    it('returns error when site code already exists', async () => {
      const createInput: CreateSiteInput = {
        name: 'Geita Gold Site',
        code: 'SITE-2025-0001',
        type: 'open_pit',
        ownerId: 'owner_1' as any,
        address: {
          street: '123 Mine Rd',
          city: 'Geita',
          county: 'Geita',
          postalCode: '00100',
          country: 'Tanzania',
          latitude: null,
          longitude: null,
        },
      };

      const existingSite = { id: asMiningSiteId('site_existing') } as MiningSite;
      const siteRepo: Partial<SiteRepository> = {
        findByCode: vi.fn().mockResolvedValue(existingSite),
      };

      const service = new SiteService(
        siteRepo as SiteRepository,
        {} as UnitRepository,
        createMockEventBus()
      );

      const result = await service.createSite(tenantId, createInput, userId, correlationId);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(SiteServiceError.SITE_CODE_EXISTS);
      }
    });

    it('returns validation error when required fields missing', async () => {
      const createInput = {
        name: '',
        type: undefined,
        ownerId: undefined,
        address: { street: '123', city: 'Geita', county: 'Geita', postalCode: '00100', country: 'TZ', latitude: null, longitude: null },
      } as unknown as CreateSiteInput;

      const siteRepo: Partial<SiteRepository> = {
        findByCode: vi.fn().mockResolvedValue(null),
        getNextSequence: vi.fn().mockResolvedValue(1),
      };

      const service = new SiteService(
        siteRepo as SiteRepository,
        {} as UnitRepository,
        createMockEventBus()
      );

      const result = await service.createSite(tenantId, createInput, userId, correlationId);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(SiteServiceError.INVALID_SITE_DATA);
      }
    });
  });

  describe('updateSite', () => {
    it('updates a site successfully', async () => {
      const existingSite = {
        id: asMiningSiteId('site_1'),
        tenantId,
        name: 'Old Name',
        code: 'SITE-001',
        type: 'open_pit',
        status: 'active',
        ownerId: 'owner_1' as any,
        address: {} as any,
        totalUnits: 10,
        activeUnits: 5,
        idleUnits: 5,
        createdAt: '',
        updatedAt: '',
        createdBy: userId,
        updatedBy: userId,
      };

      const updatedSite = { ...existingSite, name: 'Updated Name', updatedAt: new Date().toISOString() };

      const siteRepo: Partial<SiteRepository> = {
        findById: vi.fn().mockResolvedValue(existingSite),
        update: vi.fn().mockResolvedValue(updatedSite),
      };

      const service = new SiteService(
        siteRepo as SiteRepository,
        {} as UnitRepository,
        createMockEventBus()
      );

      const updateInput: UpdateSiteInput = { name: 'Updated Name' };
      const result = await service.updateSite(
        existingSite.id,
        tenantId,
        updateInput,
        userId,
        correlationId
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe('Updated Name');
      }
    });

    it('returns error when site not found', async () => {
      const siteRepo: Partial<SiteRepository> = {
        findById: vi.fn().mockResolvedValue(null),
      };

      const service = new SiteService(
        siteRepo as SiteRepository,
        {} as UnitRepository,
        createMockEventBus()
      );

      const result = await service.updateSite(
        asMiningSiteId('site_nonexistent'),
        tenantId,
        { name: 'New Name' },
        userId,
        correlationId
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(SiteServiceError.SITE_NOT_FOUND);
      }
    });
  });

  describe('unit management', () => {
    it('creates a unit successfully', async () => {
      const site = {
        id: asMiningSiteId('site_1'),
        tenantId,
        name: 'Test Site',
        code: 'SITE-001',
        type: 'open_pit',
        status: 'active',
        ownerId: 'owner_1' as any,
        address: {} as any,
        totalUnits: 0,
        activeUnits: 0,
        idleUnits: 0,
        createdAt: '',
        updatedAt: '',
        createdBy: userId,
        updatedBy: userId,
      };

      const createUnitInput: CreateUnitInput = {
        unitNumber: 'PIT-101',
        level: 1,
        type: 'open_pit_bench',
        oreGradeGramsPerTonne: 3.5,
        recoveryPct: 92,
        operatingLevy: money(50000, 'TZS'),
        bondAmount: money(100000, 'TZS'),
      };

      const mockUnit = {
        id: asMiningUnitId('unit_1'),
        tenantId,
        siteId: site.id,
        unitNumber: 'PIT-101',
        level: 1,
        type: 'open_pit_bench',
        status: 'idle',
        oreGradeGramsPerTonne: 3.5,
        recoveryPct: 92,
        operatingLevy: money(50000, 'TZS'),
        bondAmount: money(100000, 'TZS'),
        createdAt: '',
        updatedAt: '',
        createdBy: userId,
        updatedBy: userId,
      };

      const siteRepo: Partial<SiteRepository> = {
        findById: vi.fn().mockResolvedValue(site),
        update: vi.fn().mockResolvedValue(site),
      };

      const unitRepo: Partial<UnitRepository> = {
        findByUnitNumber: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue(mockUnit),
        countBySite: vi.fn().mockResolvedValue({ total: 1, inProduction: 0, idle: 1 }),
      };

      const service = new SiteService(
        siteRepo as SiteRepository,
        unitRepo as UnitRepository,
        createMockEventBus()
      );

      const result = await service.createUnit(
        site.id,
        tenantId,
        createUnitInput,
        userId,
        correlationId
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.unitNumber).toBe('PIT-101');
        expect(result.data.status).toBe('idle');
      }
      expect(unitRepo.create).toHaveBeenCalled();
      expect(siteRepo.update).toHaveBeenCalled();
    });

    it('returns error when unit number already exists', async () => {
      const site = {
        id: asMiningSiteId('site_1'),
        tenantId,
        name: 'Test Site',
        code: 'SITE-001',
        type: 'open_pit',
        status: 'active',
        ownerId: 'owner_1' as any,
        address: {} as any,
        totalUnits: 0,
        activeUnits: 0,
        idleUnits: 0,
        createdAt: '',
        updatedAt: '',
        createdBy: userId,
        updatedBy: userId,
      };

      const existingUnit = { unitNumber: 'PIT-101' } as MiningUnit;
      const siteRepo: Partial<SiteRepository> = { findById: vi.fn().mockResolvedValue(site) };
      const unitRepo: Partial<UnitRepository> = {
        findByUnitNumber: vi.fn().mockResolvedValue(existingUnit),
      };

      const service = new SiteService(
        siteRepo as SiteRepository,
        unitRepo as UnitRepository,
        createMockEventBus()
      );

      const result = await service.createUnit(
        site.id,
        tenantId,
        {
          unitNumber: 'PIT-101',
          level: 1,
          type: 'open_pit_bench',
          oreGradeGramsPerTonne: 3.5,
          recoveryPct: 92,
          operatingLevy: money(50000, 'TZS'),
          bondAmount: money(100000, 'TZS'),
        },
        userId,
        correlationId
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(SiteServiceError.UNIT_NUMBER_EXISTS);
      }
    });
  });

  describe('utilisation calculations', () => {
    it('updates site counts when unit status changes', async () => {
      const site = {
        id: asMiningSiteId('site_1'),
        tenantId,
        name: 'Test Site',
        code: 'SITE-001',
        type: 'open_pit',
        status: 'active',
        ownerId: 'owner_1' as any,
        address: {} as any,
        totalUnits: 2,
        activeUnits: 0,
        idleUnits: 2,
        createdAt: '',
        updatedAt: '',
        createdBy: userId,
        updatedBy: userId,
      };

      const unit = {
        id: asMiningUnitId('unit_1'),
        tenantId,
        siteId: site.id,
        unitNumber: 'PIT-101',
        level: 1,
        type: 'open_pit_bench',
        status: 'idle',
        oreGradeGramsPerTonne: 3.5,
        recoveryPct: 92,
        operatingLevy: money(50000, 'TZS'),
        bondAmount: money(100000, 'TZS'),
        createdAt: '',
        updatedAt: '',
        createdBy: userId,
        updatedBy: userId,
      };

      const siteRepo: Partial<SiteRepository> = {
        findById: vi.fn().mockResolvedValue(site),
        update: vi.fn().mockImplementation((s) => Promise.resolve(s)),
      };

      const unitRepo: Partial<UnitRepository> = {
        findById: vi.fn().mockResolvedValue(unit),
        update: vi.fn().mockImplementation((u) => Promise.resolve({ ...u, status: 'in_production' })),
        countBySite: vi.fn().mockResolvedValue({ total: 2, inProduction: 1, idle: 1 }),
      };

      const service = new SiteService(
        siteRepo as SiteRepository,
        unitRepo as UnitRepository,
        createMockEventBus()
      );

      const result = await service.updateUnitStatus(
        unit.id,
        tenantId,
        'in_production',
        userId,
        correlationId
      );

      expect(result.success).toBe(true);
      expect(unitRepo.update).toHaveBeenCalled();
      expect(siteRepo.update).toHaveBeenCalled();
    });
  });
});
