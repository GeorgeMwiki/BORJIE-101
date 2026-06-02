/**
 * Unit tests for OfftakeService
 */

import { describe, it, expect, vi } from 'vitest';
import type { TenantId, UserId } from '@borjie/domain-models';
import {
  type Offtake,
  type Customer,
  type Money,
  money,
  // `asOfftakeId` is exported flat only under its legacy `asLeaseId` name at
  // the @borjie/domain-models root (the flat-export promotion is an
  // off-limits domain-models concern); alias locally to the canonical name.
  asLeaseId as asOfftakeId,
  asCustomerId,
  asPropertyId,
  asUnitId,
} from '@borjie/domain-models';
import type { OfftakeRepository, CustomerRepository } from '../index.js';
import type { EventBus } from '../../common/events.js';
import {
  OfftakeService,
  OfftakeServiceError,
  type CreateOfftakeInput,
  type RenewalInput,
} from '../index.js';

function createMockEventBus(): EventBus {
  return {
    publish: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn().mockReturnValue(() => {}),
  };
}

describe('OfftakeService', () => {
  const tenantId = 'tnt_test' as TenantId;
  const userId = 'usr_1' as UserId;
  const correlationId = 'corr_123';

  describe('offtake creation', () => {
    it('creates an offtake successfully', async () => {
      const customer = {
        id: asCustomerId('cust_1'),
        tenantId,
        customerNumber: 'CUST-2025-0001',
        profile: {
          firstName: 'John',
          lastName: 'Doe',
          email: 'john@example.com',
          phone: '+254700000000',
        },
        status: 'active',
        createdAt: '',
        updatedAt: '',
        createdBy: userId,
        updatedBy: userId,
      } as Customer;

      const createOfftakeInput: CreateOfftakeInput = {
        propertyId: asPropertyId('prop_1'),
        unitId: asUnitId('unit_1'),
        customerId: customer.id,
        type: 'fixed_term',
        startDate: '2025-01-01',
        endDate: '2025-12-31',
        moveInDate: '2025-01-01',
        royaltyAmount: money(50000, 'KES'),
        securityDeposit: money(100000, 'KES'),
      };

      const mockOfftake = {
        id: asOfftakeId('offtake_1'),
        tenantId,
        offtakeNumber: 'OFFTAKE-2025-0001',
        propertyId: createOfftakeInput.propertyId,
        unitId: createOfftakeInput.unitId,
        customerId: customer.id,
        type: 'spot',
        status: 'draft',
        startDate: createOfftakeInput.startDate,
        endDate: createOfftakeInput.endDate,
        moveInDate: createOfftakeInput.moveInDate,
        royaltyAmount: createOfftakeInput.royaltyAmount,
        securityDeposit: createOfftakeInput.securityDeposit,
        createdAt: '',
        updatedAt: '',
        createdBy: userId,
        updatedBy: userId,
      };

      const customerRepo: Partial<CustomerRepository> = {
        findById: vi.fn().mockResolvedValue(customer),
      };

      const offtakeRepo: Partial<OfftakeRepository> = {
        findActiveByUnit: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue(mockOfftake),
        getNextSequence: vi.fn().mockResolvedValue(1),
      };

      const service = new OfftakeService(
        offtakeRepo as OfftakeRepository,
        customerRepo as CustomerRepository,
        createMockEventBus()
      );

      const result = await service.createOfftake(tenantId, createOfftakeInput, userId, correlationId);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.status).toBe('draft');
        expect(result.data.offtakeNumber).toBeDefined();
      }
      expect(offtakeRepo.create).toHaveBeenCalled();
    });

    it('returns error when customer not found', async () => {
      const createOfftakeInput: CreateOfftakeInput = {
        propertyId: asPropertyId('prop_1'),
        unitId: asUnitId('unit_1'),
        customerId: asCustomerId('cust_nonexistent'),
        type: 'spot',
        startDate: '2025-01-01',
        moveInDate: '2025-01-01',
        royaltyAmount: money(50000, 'KES'),
        securityDeposit: money(100000, 'KES'),
      };

      const customerRepo: Partial<CustomerRepository> = {
        findById: vi.fn().mockResolvedValue(null),
      };

      const offtakeRepo: Partial<OfftakeRepository> = {
        findActiveByUnit: vi.fn().mockResolvedValue(null),
      };

      const service = new OfftakeService(
        offtakeRepo as OfftakeRepository,
        customerRepo as CustomerRepository,
        createMockEventBus()
      );

      const result = await service.createOfftake(tenantId, createOfftakeInput, userId, correlationId);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(OfftakeServiceError.CUSTOMER_NOT_FOUND);
      }
    });

    it('returns error when unit already contracted', async () => {
      const customer = { id: asCustomerId('cust_1'), tenantId } as Customer;
      const activeOfftake = { id: asOfftakeId('offtake_active'), unitId: asUnitId('unit_1') } as Offtake;

      const customerRepo: Partial<CustomerRepository> = {
        findById: vi.fn().mockResolvedValue(customer),
      };

      const offtakeRepo: Partial<OfftakeRepository> = {
        findActiveByUnit: vi.fn().mockResolvedValue(activeOfftake),
      };

      const service = new OfftakeService(
        offtakeRepo as OfftakeRepository,
        customerRepo as CustomerRepository,
        createMockEventBus()
      );

      const result = await service.createOfftake(
        tenantId,
        {
          propertyId: asPropertyId('prop_1'),
          unitId: asUnitId('unit_1'),
          customerId: customer.id,
          type: 'fixed_term',
          startDate: '2025-01-01',
          moveInDate: '2025-01-01',
          royaltyAmount: money(50000, 'KES'),
          securityDeposit: money(100000, 'KES'),
        },
        userId,
        correlationId
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(OfftakeServiceError.UNIT_ALREADY_CONTRACTED);
      }
    });
  });

  describe('offtake activation', () => {
    it('activates a draft offtake successfully', async () => {
      const draftOfftake = {
        id: asOfftakeId('offtake_1'),
        tenantId,
        offtakeNumber: 'OFT-2025-0001',
        propertyId: asPropertyId('prop_1'),
        unitId: asUnitId('unit_1'),
        customerId: asCustomerId('cust_1'),
        type: 'fixed_term' as const,
        status: 'draft' as const,
        startDate: '2025-01-01',
        endDate: '2025-12-31',
        moveInDate: '2025-01-01',
        moveOutDate: null,
        royaltyAmount: money(50000, 'KES'),
        paymentFrequency: 'monthly' as const,
        royaltyDueDay: 1,
        securityDeposit: money(100000, 'KES'),
        depositPaid: false,
        lateFeePercentage: 5,
        lateFeeGraceDays: 5,
        additionalOccupants: [],
        specialTerms: null,
        documentIds: [],
        signedAt: null,
        terminatedAt: null,
        terminationReason: null,
        renewedFromOfftakeId: null,
        renewedToOfftakeId: null,
        createdAt: '',
        updatedAt: '',
        createdBy: userId,
        updatedBy: userId,
      };

      const activatedOfftake = {
        ...draftOfftake,
        status: 'active' as const,
        documentIds: ['doc_1'],
        signedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        updatedBy: userId,
      };

      const offtakeRepo: Partial<OfftakeRepository> = {
        findById: vi.fn().mockResolvedValue(draftOfftake),
        findActiveByUnit: vi.fn().mockResolvedValue(null),
        update: vi.fn().mockResolvedValue(activatedOfftake),
      };

      const service = new OfftakeService(
        offtakeRepo as OfftakeRepository,
        {} as CustomerRepository,
        createMockEventBus()
      );

      const result = await service.activateOfftake(
        draftOfftake.id,
        tenantId,
        ['doc_1'],
        userId,
        correlationId
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.status).toBe('active');
      }
      expect(offtakeRepo.update).toHaveBeenCalled();
      expect(offtakeRepo.findActiveByUnit).toHaveBeenCalled(); // verify unit still available
    });

    it('returns error when offtake cannot be activated from current status', async () => {
      const activeOfftake = {
        id: asOfftakeId('offtake_1'),
        tenantId,
        status: 'active',
        unitId: asUnitId('unit_1'),
      } as Offtake;

      const offtakeRepo: Partial<OfftakeRepository> = {
        findById: vi.fn().mockResolvedValue(activeOfftake),
      };

      const service = new OfftakeService(
        offtakeRepo as OfftakeRepository,
        {} as CustomerRepository,
        createMockEventBus()
      );

      const result = await service.activateOfftake(
        activeOfftake.id,
        tenantId,
        ['doc_1'],
        userId,
        correlationId
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(OfftakeServiceError.OFFTAKE_CANNOT_BE_ACTIVATED);
      }
    });
  });

  describe('offtake termination', () => {
    it('terminates an active offtake successfully', async () => {
      const activeOfftake = {
        id: asOfftakeId('offtake_1'),
        tenantId,
        offtakeNumber: 'OFT-2025-0001',
        propertyId: asPropertyId('prop_1'),
        unitId: asUnitId('unit_1'),
        customerId: asCustomerId('cust_1'),
        type: 'fixed_term' as const,
        status: 'active' as const,
        startDate: '2025-01-01',
        endDate: '2025-12-31',
        moveInDate: '2025-01-01',
        moveOutDate: null,
        royaltyAmount: money(50000, 'KES'),
        paymentFrequency: 'monthly' as const,
        royaltyDueDay: 1,
        securityDeposit: money(100000, 'KES'),
        depositPaid: false,
        lateFeePercentage: 5,
        lateFeeGraceDays: 5,
        additionalOccupants: [],
        specialTerms: null,
        documentIds: [],
        signedAt: '',
        terminatedAt: null,
        terminationReason: null,
        renewedFromOfftakeId: null,
        renewedToOfftakeId: null,
        createdAt: '',
        updatedAt: '',
        createdBy: userId,
        updatedBy: userId,
      };

      const terminatedOfftake = {
        ...activeOfftake,
        status: 'terminated' as const,
        terminatedAt: new Date().toISOString(),
        terminationReason: 'Mutual agreement',
        moveOutDate: '2025-06-30',
      };

      const offtakeRepo: Partial<OfftakeRepository> = {
        findById: vi.fn().mockResolvedValue(activeOfftake),
        update: vi.fn().mockResolvedValue(terminatedOfftake),
      };

      const service = new OfftakeService(
        offtakeRepo as OfftakeRepository,
        {} as CustomerRepository,
        createMockEventBus()
      );

      const result = await service.terminateOfftake(
        activeOfftake.id,
        tenantId,
        'Mutual agreement',
        '2025-06-30',
        userId,
        correlationId
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.status).toBe('terminated');
      }
      expect(offtakeRepo.update).toHaveBeenCalled();
    });

    it('returns error when offtake cannot be terminated from current status', async () => {
      const draftOfftake = {
        id: asOfftakeId('offtake_1'),
        tenantId,
        status: 'draft',
      } as Offtake;

      const offtakeRepo: Partial<OfftakeRepository> = {
        findById: vi.fn().mockResolvedValue(draftOfftake),
      };

      const service = new OfftakeService(
        offtakeRepo as OfftakeRepository,
        {} as CustomerRepository,
        createMockEventBus()
      );

      const result = await service.terminateOfftake(
        draftOfftake.id,
        tenantId,
        'Reason',
        '2025-06-30',
        userId,
        correlationId
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(OfftakeServiceError.OFFTAKE_CANNOT_BE_TERMINATED);
      }
    });
  });

  describe('renewal flows', () => {
    it('renews an active offtake successfully', async () => {
      const expiringOfftake = {
        id: asOfftakeId('offtake_1'),
        tenantId,
        offtakeNumber: 'OFT-2025-0001',
        propertyId: asPropertyId('prop_1'),
        unitId: asUnitId('unit_1'),
        customerId: asCustomerId('cust_1'),
        type: 'fixed_term' as const,
        status: 'expiring_soon' as const,
        startDate: '2025-01-01',
        endDate: '2025-12-31',
        moveInDate: '2025-01-01',
        moveOutDate: null,
        royaltyAmount: money(50000, 'KES'),
        paymentFrequency: 'monthly' as const,
        royaltyDueDay: 1,
        securityDeposit: money(100000, 'KES'),
        depositPaid: false,
        lateFeePercentage: 5,
        lateFeeGraceDays: 5,
        additionalOccupants: [],
        specialTerms: null,
        documentIds: [],
        signedAt: '',
        terminatedAt: null,
        terminationReason: null,
        renewedFromOfftakeId: null,
        renewedToOfftakeId: null,
        createdAt: '',
        updatedAt: '',
        createdBy: userId,
        updatedBy: userId,
      };

      const newOfftake = {
        ...expiringOfftake,
        id: asOfftakeId('offtake_2'),
        offtakeNumber: 'OFFTAKE-2025-0002',
        startDate: '2025-12-31',
        endDate: '2026-12-31',
        moveInDate: '2025-12-31',
        renewedFromOfftakeId: expiringOfftake.id,
      };

      const offtakeRepo: Partial<OfftakeRepository> = {
        findById: vi.fn().mockResolvedValue(expiringOfftake),
        create: vi.fn().mockResolvedValue(newOfftake),
        update: vi.fn().mockImplementation((l) => Promise.resolve(l)),
        getNextSequence: vi.fn().mockResolvedValue(2),
      };

      const service = new OfftakeService(
        offtakeRepo as OfftakeRepository,
        {} as CustomerRepository,
        createMockEventBus()
      );

      const renewalInput: RenewalInput = {
        newEndDate: '2026-12-31',
      };

      const result = await service.renewOfftake(
        expiringOfftake.id,
        tenantId,
        renewalInput,
        userId,
        correlationId
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.id).not.toBe(expiringOfftake.id);
        expect(result.data.endDate).toBe('2026-12-31');
      }
      expect(offtakeRepo.update).toHaveBeenCalled();
      expect(offtakeRepo.create).toHaveBeenCalled();
    });

    it('returns error when renewal not allowed for offtake status', async () => {
      const terminatedOfftake = {
        id: asOfftakeId('offtake_1'),
        tenantId,
        status: 'terminated',
      } as Offtake;

      const offtakeRepo: Partial<OfftakeRepository> = {
        findById: vi.fn().mockResolvedValue(terminatedOfftake),
      };

      const service = new OfftakeService(
        offtakeRepo as OfftakeRepository,
        {} as CustomerRepository,
        createMockEventBus()
      );

      const result = await service.renewOfftake(
        terminatedOfftake.id,
        tenantId,
        { newEndDate: '2026-12-31' },
        userId,
        correlationId
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(OfftakeServiceError.RENEWAL_NOT_ALLOWED);
      }
    });
  });
});
