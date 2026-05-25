/**
 * Unit tests for PropertyService
 */

import { describe, it, expect, vi } from 'vitest';
import type { TenantId, UserId } from '@borjie/domain-models';
import {
  type Property,
  type PropertyId,
  type Unit,
  type UnitId,
  type Money,
  money,
  asPropertyId,
  asUnitId,
  asUserId,
} from '@borjie/domain-models';
import type { PropertyRepository, UnitRepository } from '../index.js';
import type { EventBus } from '../../common/events.js';
import {
  PropertyService,
  PropertyServiceError,
  type CreatePropertyInput,
  type UpdatePropertyInput,
  type CreateUnitInput,
  type UpdateUnitInput,
} from '../index.js';

function createMockEventBus(): EventBus {
  return {
    publish: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn().mockReturnValue(() => {}),
  };
}

describe('PropertyService', () => {
  const tenantId = 'tnt_test' as TenantId;
  const userId = asUserId('usr_1');
  const correlationId = 'corr_123';

  describe('createProperty', () => {
    it('creates a property successfully with valid input', async () => {
      const createInput: CreatePropertyInput = {
        name: 'Sunset Apartments',
        type: 'apartment',
        ownerId: 'owner_1' as any,
        address: {
          line1: '123 Main St',
          line2: null,
          city: 'Nairobi',
          state: 'Nairobi',
          postalCode: '00100',
          country: 'Kenya',
        },
      };

      const mockProperty = {
        id: asPropertyId('prop_1'),
        tenantId,
        name: 'Sunset Apartments',
        code: 'PROP-2025-0001',
        type: 'apartment',
        status: 'active',
        ownerId: 'owner_1' as any,
        address: createInput.address,
        totalUnits: 0,
        occupiedUnits: 0,
        vacantUnits: 0,
        createdAt: '',
        updatedAt: '',
        createdBy: userId,
        updatedBy: userId,
      };

      const propertyRepo: Partial<PropertyRepository> = {
        findByCode: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockImplementation((p) => Promise.resolve({ ...p, ...mockProperty })),
        getNextSequence: vi.fn().mockResolvedValue(1),
      };

      const unitRepo: Partial<UnitRepository> = {};
      const eventBus = createMockEventBus();
      const service = new PropertyService(
        propertyRepo as PropertyRepository,
        unitRepo as UnitRepository,
        eventBus
      );

      const result = await service.createProperty(tenantId, createInput, userId, correlationId);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe('Sunset Apartments');
        expect(result.data.code).toBeDefined();
      }
      expect(propertyRepo.findByCode).toHaveBeenCalled();
      expect(propertyRepo.create).toHaveBeenCalled();
      expect(eventBus.publish).toHaveBeenCalled();
    });

    it('returns error when property code already exists', async () => {
      const createInput: CreatePropertyInput = {
        name: 'Sunset Apartments',
        code: 'PROP-2025-0001',
        type: 'apartment',
        ownerId: 'owner_1' as any,
        address: {
          line1: '123 Main St',
          line2: null,
          city: 'Nairobi',
          state: 'Nairobi',
          postalCode: '00100',
          country: 'Kenya',
        },
      };

      const existingProperty = { id: asPropertyId('prop_existing') } as Property;
      const propertyRepo: Partial<PropertyRepository> = {
        findByCode: vi.fn().mockResolvedValue(existingProperty),
      };

      const service = new PropertyService(
        propertyRepo as PropertyRepository,
        {} as UnitRepository,
        createMockEventBus()
      );

      const result = await service.createProperty(tenantId, createInput, userId, correlationId);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(PropertyServiceError.PROPERTY_CODE_EXISTS);
      }
    });

    it('returns validation error when required fields missing', async () => {
      const createInput = {
        name: '',
        type: undefined,
        ownerId: undefined,
        address: { line1: '123', line2: null, city: 'Nairobi', state: 'NS', postalCode: '00100', country: 'KE' },
      } as CreatePropertyInput;

      const propertyRepo: Partial<PropertyRepository> = {
        findByCode: vi.fn().mockResolvedValue(null),
        getNextSequence: vi.fn().mockResolvedValue(1),
      };

      const service = new PropertyService(
        propertyRepo as PropertyRepository,
        {} as UnitRepository,
        createMockEventBus()
      );

      const result = await service.createProperty(tenantId, createInput, userId, correlationId);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(PropertyServiceError.INVALID_PROPERTY_DATA);
      }
    });
  });

  describe('updateProperty', () => {
    it('updates a property successfully', async () => {
      const existingProperty = {
        id: asPropertyId('prop_1'),
        tenantId,
        name: 'Old Name',
        code: 'PROP-001',
        type: 'apartment',
        status: 'active',
        ownerId: 'owner_1' as any,
        address: {} as any,
        totalUnits: 10,
        occupiedUnits: 5,
        vacantUnits: 5,
        createdAt: '',
        updatedAt: '',
        createdBy: userId,
        updatedBy: userId,
      };

      const updatedProperty = { ...existingProperty, name: 'Updated Name', updatedAt: new Date().toISOString() };

      const propertyRepo: Partial<PropertyRepository> = {
        findById: vi.fn().mockResolvedValue(existingProperty),
        update: vi.fn().mockResolvedValue(updatedProperty),
      };

      const service = new PropertyService(
        propertyRepo as PropertyRepository,
        {} as UnitRepository,
        createMockEventBus()
      );

      const updateInput: UpdatePropertyInput = { name: 'Updated Name' };
      const result = await service.updateProperty(
        existingProperty.id,
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

    it('returns error when property not found', async () => {
      const propertyRepo: Partial<PropertyRepository> = {
        findById: vi.fn().mockResolvedValue(null),
      };

      const service = new PropertyService(
        propertyRepo as PropertyRepository,
        {} as UnitRepository,
        createMockEventBus()
      );

      const result = await service.updateProperty(
        asPropertyId('prop_nonexistent'),
        tenantId,
        { name: 'New Name' },
        userId,
        correlationId
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(PropertyServiceError.PROPERTY_NOT_FOUND);
      }
    });
  });

  describe('unit management', () => {
    it('creates a unit successfully', async () => {
      const property = {
        id: asPropertyId('prop_1'),
        tenantId,
        name: 'Test Property',
        code: 'PROP-001',
        type: 'apartment',
        status: 'active',
        ownerId: 'owner_1' as any,
        address: {} as any,
        totalUnits: 0,
        occupiedUnits: 0,
        vacantUnits: 0,
        createdAt: '',
        updatedAt: '',
        createdBy: userId,
        updatedBy: userId,
      };

      const createUnitInput: CreateUnitInput = {
        unitNumber: '101',
        floor: 1,
        type: 'apartment',
        bedrooms: 2,
        bathrooms: 1,
        monthlyRent: money(50000, 'KES'),
        depositAmount: money(100000, 'KES'),
      };

      const mockUnit = {
        id: asUnitId('unit_1'),
        tenantId,
        propertyId: property.id,
        unitNumber: '101',
        floor: 1,
        type: 'apartment',
        status: 'vacant',
        bedrooms: 2,
        bathrooms: 1,
        monthlyRent: money(50000, 'KES'),
        depositAmount: money(100000, 'KES'),
        createdAt: '',
        updatedAt: '',
        createdBy: userId,
        updatedBy: userId,
      };

      const propertyRepo: Partial<PropertyRepository> = {
        findById: vi.fn().mockResolvedValue(property),
        update: vi.fn().mockResolvedValue(property),
      };

      const unitRepo: Partial<UnitRepository> = {
        findByUnitNumber: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue(mockUnit),
        countByProperty: vi.fn().mockResolvedValue({ total: 1, occupied: 0, vacant: 1 }),
      };

      const service = new PropertyService(
        propertyRepo as PropertyRepository,
        unitRepo as UnitRepository,
        createMockEventBus()
      );

      const result = await service.createUnit(
        property.id,
        tenantId,
        createUnitInput,
        userId,
        correlationId
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.unitNumber).toBe('101');
        expect(result.data.status).toBe('vacant');
      }
      expect(unitRepo.create).toHaveBeenCalled();
      expect(propertyRepo.update).toHaveBeenCalled();
    });

    it('returns error when unit number already exists', async () => {
      const property = {
        id: asPropertyId('prop_1'),
        tenantId,
        name: 'Test Property',
        code: 'PROP-001',
        type: 'apartment',
        status: 'active',
        ownerId: 'owner_1' as any,
        address: {} as any,
        totalUnits: 0,
        occupiedUnits: 0,
        vacantUnits: 0,
        createdAt: '',
        updatedAt: '',
        createdBy: userId,
        updatedBy: userId,
      };

      const existingUnit = { unitNumber: '101' } as Unit;
      const propertyRepo: Partial<PropertyRepository> = { findById: vi.fn().mockResolvedValue(property) };
      const unitRepo: Partial<UnitRepository> = {
        findByUnitNumber: vi.fn().mockResolvedValue(existingUnit),
      };

      const service = new PropertyService(
        propertyRepo as PropertyRepository,
        unitRepo as UnitRepository,
        createMockEventBus()
      );

      const result = await service.createUnit(
        property.id,
        tenantId,
        {
          unitNumber: '101',
          floor: 1,
          type: 'apartment',
          bedrooms: 2,
          bathrooms: 1,
          monthlyRent: money(50000, 'KES'),
          depositAmount: money(100000, 'KES'),
        },
        userId,
        correlationId
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(PropertyServiceError.UNIT_NUMBER_EXISTS);
      }
    });
  });

  describe('occupancy calculations', () => {
    it('updates property counts when unit status changes', async () => {
      const property = {
        id: asPropertyId('prop_1'),
        tenantId,
        name: 'Test Property',
        code: 'PROP-001',
        type: 'apartment',
        status: 'active',
        ownerId: 'owner_1' as any,
        address: {} as any,
        totalUnits: 2,
        occupiedUnits: 0,
        vacantUnits: 2,
        createdAt: '',
        updatedAt: '',
        createdBy: userId,
        updatedBy: userId,
      };

      const unit = {
        id: asUnitId('unit_1'),
        tenantId,
        propertyId: property.id,
        unitNumber: '101',
        floor: 1,
        type: 'apartment',
        status: 'vacant',
        bedrooms: 2,
        bathrooms: 1,
        monthlyRent: money(50000, 'KES'),
        depositAmount: money(100000, 'KES'),
        createdAt: '',
        updatedAt: '',
        createdBy: userId,
        updatedBy: userId,
      };

      const propertyRepo: Partial<PropertyRepository> = {
        findById: vi.fn().mockResolvedValue(property),
        update: vi.fn().mockImplementation((p) => Promise.resolve(p)),
      };

      const unitRepo: Partial<UnitRepository> = {
        findById: vi.fn().mockResolvedValue(unit),
        update: vi.fn().mockImplementation((u) => Promise.resolve({ ...u, status: 'occupied' })),
        countByProperty: vi.fn().mockResolvedValue({ total: 2, occupied: 1, vacant: 1 }),
      };

      const service = new PropertyService(
        propertyRepo as PropertyRepository,
        unitRepo as UnitRepository,
        createMockEventBus()
      );

      const result = await service.updateUnitStatus(
        unit.id,
        tenantId,
        'occupied',
        userId,
        correlationId
      );

      expect(result.success).toBe(true);
      expect(unitRepo.update).toHaveBeenCalled();
      expect(propertyRepo.update).toHaveBeenCalled();
    });
  });
});
