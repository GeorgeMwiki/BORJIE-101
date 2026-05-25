/**
 * Unit tests for LeaseService
 */

import { describe, it, expect, vi } from 'vitest';
import type { TenantId, UserId } from '@borjie/domain-models';
import {
  type Lease,
  type LeaseId,
  type Customer,
  type CustomerId,
  type Money,
  money,
  asLeaseId,
  asCustomerId,
  asPropertyId,
  asUnitId,
} from '@borjie/domain-models';
import type { LeaseRepository, CustomerRepository } from '../index.js';
import type { EventBus } from '../../common/events.js';
import {
  LeaseService,
  LeaseServiceError,
  type CreateLeaseInput,
  type RenewalInput,
} from '../index.js';

function createMockEventBus(): EventBus {
  return {
    publish: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn().mockReturnValue(() => {}),
  };
}

describe('LeaseService', () => {
  const tenantId = 'tnt_test' as TenantId;
  const userId = 'usr_1' as UserId;
  const correlationId = 'corr_123';

  describe('lease creation', () => {
    it('creates a lease successfully', async () => {
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

      const createLeaseInput: CreateLeaseInput = {
        propertyId: asPropertyId('prop_1'),
        unitId: asUnitId('unit_1'),
        customerId: customer.id,
        type: 'fixed_term',
        startDate: '2025-01-01',
        endDate: '2025-12-31',
        moveInDate: '2025-01-01',
        rentAmount: money(50000, 'KES'),
        securityDeposit: money(100000, 'KES'),
      };

      const mockLease = {
        id: asLeaseId('lease_1'),
        tenantId,
        leaseNumber: 'LEASE-2025-0001',
        propertyId: createLeaseInput.propertyId,
        unitId: createLeaseInput.unitId,
        customerId: customer.id,
        type: 'standard',
        status: 'draft',
        startDate: createLeaseInput.startDate,
        endDate: createLeaseInput.endDate,
        moveInDate: createLeaseInput.moveInDate,
        rentAmount: createLeaseInput.rentAmount,
        securityDeposit: createLeaseInput.securityDeposit,
        createdAt: '',
        updatedAt: '',
        createdBy: userId,
        updatedBy: userId,
      };

      const customerRepo: Partial<CustomerRepository> = {
        findById: vi.fn().mockResolvedValue(customer),
      };

      const leaseRepo: Partial<LeaseRepository> = {
        findActiveByUnit: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue(mockLease),
        getNextSequence: vi.fn().mockResolvedValue(1),
      };

      const service = new LeaseService(
        leaseRepo as LeaseRepository,
        customerRepo as CustomerRepository,
        createMockEventBus()
      );

      const result = await service.createLease(tenantId, createLeaseInput, userId, correlationId);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.status).toBe('draft');
        expect(result.data.leaseNumber).toBeDefined();
      }
      expect(leaseRepo.create).toHaveBeenCalled();
    });

    it('returns error when customer not found', async () => {
      const createLeaseInput: CreateLeaseInput = {
        propertyId: asPropertyId('prop_1'),
        unitId: asUnitId('unit_1'),
        customerId: asCustomerId('cust_nonexistent'),
        type: 'standard',
        startDate: '2025-01-01',
        moveInDate: '2025-01-01',
        rentAmount: money(50000, 'KES'),
        securityDeposit: money(100000, 'KES'),
      };

      const customerRepo: Partial<CustomerRepository> = {
        findById: vi.fn().mockResolvedValue(null),
      };

      const leaseRepo: Partial<LeaseRepository> = {
        findActiveByUnit: vi.fn().mockResolvedValue(null),
      };

      const service = new LeaseService(
        leaseRepo as LeaseRepository,
        customerRepo as CustomerRepository,
        createMockEventBus()
      );

      const result = await service.createLease(tenantId, createLeaseInput, userId, correlationId);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(LeaseServiceError.CUSTOMER_NOT_FOUND);
      }
    });

    it('returns error when unit already leased', async () => {
      const customer = { id: asCustomerId('cust_1'), tenantId } as Customer;
      const activeLease = { id: asLeaseId('lease_active'), unitId: asUnitId('unit_1') } as Lease;

      const customerRepo: Partial<CustomerRepository> = {
        findById: vi.fn().mockResolvedValue(customer),
      };

      const leaseRepo: Partial<LeaseRepository> = {
        findActiveByUnit: vi.fn().mockResolvedValue(activeLease),
      };

      const service = new LeaseService(
        leaseRepo as LeaseRepository,
        customerRepo as CustomerRepository,
        createMockEventBus()
      );

      const result = await service.createLease(
        tenantId,
        {
          propertyId: asPropertyId('prop_1'),
          unitId: asUnitId('unit_1'),
          customerId: customer.id,
          type: 'fixed_term',
          startDate: '2025-01-01',
          moveInDate: '2025-01-01',
          rentAmount: money(50000, 'KES'),
          securityDeposit: money(100000, 'KES'),
        },
        userId,
        correlationId
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(LeaseServiceError.UNIT_ALREADY_LEASED);
      }
    });
  });

  describe('lease activation', () => {
    it('activates a draft lease successfully', async () => {
      const draftLease = {
        id: asLeaseId('lease_1'),
        tenantId,
        leaseNumber: 'LSE-2025-0001',
        propertyId: asPropertyId('prop_1'),
        unitId: asUnitId('unit_1'),
        customerId: asCustomerId('cust_1'),
        type: 'fixed_term' as const,
        status: 'draft' as const,
        startDate: '2025-01-01',
        endDate: '2025-12-31',
        moveInDate: '2025-01-01',
        moveOutDate: null,
        rentAmount: money(50000, 'KES'),
        rentFrequency: 'monthly' as const,
        rentDueDay: 1,
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
        renewedFromLeaseId: null,
        renewedToLeaseId: null,
        createdAt: '',
        updatedAt: '',
        createdBy: userId,
        updatedBy: userId,
      };

      const activatedLease = {
        ...draftLease,
        status: 'active' as const,
        documentIds: ['doc_1'],
        signedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        updatedBy: userId,
      };

      const leaseRepo: Partial<LeaseRepository> = {
        findById: vi.fn().mockResolvedValue(draftLease),
        findActiveByUnit: vi.fn().mockResolvedValue(null),
        update: vi.fn().mockResolvedValue(activatedLease),
      };

      const service = new LeaseService(
        leaseRepo as LeaseRepository,
        {} as CustomerRepository,
        createMockEventBus()
      );

      const result = await service.activateLease(
        draftLease.id,
        tenantId,
        ['doc_1'],
        userId,
        correlationId
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.status).toBe('active');
      }
      expect(leaseRepo.update).toHaveBeenCalled();
      expect(leaseRepo.findActiveByUnit).toHaveBeenCalled(); // verify unit still available
    });

    it('returns error when lease cannot be activated from current status', async () => {
      const activeLease = {
        id: asLeaseId('lease_1'),
        tenantId,
        status: 'active',
        unitId: asUnitId('unit_1'),
      } as Lease;

      const leaseRepo: Partial<LeaseRepository> = {
        findById: vi.fn().mockResolvedValue(activeLease),
      };

      const service = new LeaseService(
        leaseRepo as LeaseRepository,
        {} as CustomerRepository,
        createMockEventBus()
      );

      const result = await service.activateLease(
        activeLease.id,
        tenantId,
        ['doc_1'],
        userId,
        correlationId
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(LeaseServiceError.LEASE_CANNOT_BE_ACTIVATED);
      }
    });
  });

  describe('lease termination', () => {
    it('terminates an active lease successfully', async () => {
      const activeLease = {
        id: asLeaseId('lease_1'),
        tenantId,
        leaseNumber: 'LSE-2025-0001',
        propertyId: asPropertyId('prop_1'),
        unitId: asUnitId('unit_1'),
        customerId: asCustomerId('cust_1'),
        type: 'fixed_term' as const,
        status: 'active' as const,
        startDate: '2025-01-01',
        endDate: '2025-12-31',
        moveInDate: '2025-01-01',
        moveOutDate: null,
        rentAmount: money(50000, 'KES'),
        rentFrequency: 'monthly' as const,
        rentDueDay: 1,
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
        renewedFromLeaseId: null,
        renewedToLeaseId: null,
        createdAt: '',
        updatedAt: '',
        createdBy: userId,
        updatedBy: userId,
      };

      const terminatedLease = {
        ...activeLease,
        status: 'terminated' as const,
        terminatedAt: new Date().toISOString(),
        terminationReason: 'Mutual agreement',
        moveOutDate: '2025-06-30',
      };

      const leaseRepo: Partial<LeaseRepository> = {
        findById: vi.fn().mockResolvedValue(activeLease),
        update: vi.fn().mockResolvedValue(terminatedLease),
      };

      const service = new LeaseService(
        leaseRepo as LeaseRepository,
        {} as CustomerRepository,
        createMockEventBus()
      );

      const result = await service.terminateLease(
        activeLease.id,
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
      expect(leaseRepo.update).toHaveBeenCalled();
    });

    it('returns error when lease cannot be terminated from current status', async () => {
      const draftLease = {
        id: asLeaseId('lease_1'),
        tenantId,
        status: 'draft',
      } as Lease;

      const leaseRepo: Partial<LeaseRepository> = {
        findById: vi.fn().mockResolvedValue(draftLease),
      };

      const service = new LeaseService(
        leaseRepo as LeaseRepository,
        {} as CustomerRepository,
        createMockEventBus()
      );

      const result = await service.terminateLease(
        draftLease.id,
        tenantId,
        'Reason',
        '2025-06-30',
        userId,
        correlationId
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(LeaseServiceError.LEASE_CANNOT_BE_TERMINATED);
      }
    });
  });

  describe('renewal flows', () => {
    it('renews an active lease successfully', async () => {
      const expiringLease = {
        id: asLeaseId('lease_1'),
        tenantId,
        leaseNumber: 'LSE-2025-0001',
        propertyId: asPropertyId('prop_1'),
        unitId: asUnitId('unit_1'),
        customerId: asCustomerId('cust_1'),
        type: 'fixed_term' as const,
        status: 'expiring_soon' as const,
        startDate: '2025-01-01',
        endDate: '2025-12-31',
        moveInDate: '2025-01-01',
        moveOutDate: null,
        rentAmount: money(50000, 'KES'),
        rentFrequency: 'monthly' as const,
        rentDueDay: 1,
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
        renewedFromLeaseId: null,
        renewedToLeaseId: null,
        createdAt: '',
        updatedAt: '',
        createdBy: userId,
        updatedBy: userId,
      };

      const newLease = {
        ...expiringLease,
        id: asLeaseId('lease_2'),
        leaseNumber: 'LEASE-2025-0002',
        startDate: '2025-12-31',
        endDate: '2026-12-31',
        moveInDate: '2025-12-31',
        renewedFromLeaseId: expiringLease.id,
      };

      const leaseRepo: Partial<LeaseRepository> = {
        findById: vi.fn().mockResolvedValue(expiringLease),
        create: vi.fn().mockResolvedValue(newLease),
        update: vi.fn().mockImplementation((l) => Promise.resolve(l)),
        getNextSequence: vi.fn().mockResolvedValue(2),
      };

      const service = new LeaseService(
        leaseRepo as LeaseRepository,
        {} as CustomerRepository,
        createMockEventBus()
      );

      const renewalInput: RenewalInput = {
        newEndDate: '2026-12-31',
      };

      const result = await service.renewLease(
        expiringLease.id,
        tenantId,
        renewalInput,
        userId,
        correlationId
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.id).not.toBe(expiringLease.id);
        expect(result.data.endDate).toBe('2026-12-31');
      }
      expect(leaseRepo.update).toHaveBeenCalled();
      expect(leaseRepo.create).toHaveBeenCalled();
    });

    it('returns error when renewal not allowed for lease status', async () => {
      const terminatedLease = {
        id: asLeaseId('lease_1'),
        tenantId,
        status: 'terminated',
      } as Lease;

      const leaseRepo: Partial<LeaseRepository> = {
        findById: vi.fn().mockResolvedValue(terminatedLease),
      };

      const service = new LeaseService(
        leaseRepo as LeaseRepository,
        {} as CustomerRepository,
        createMockEventBus()
      );

      const result = await service.renewLease(
        terminatedLease.id,
        tenantId,
        { newEndDate: '2026-12-31' },
        userId,
        correlationId
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(LeaseServiceError.RENEWAL_NOT_ALLOWED);
      }
    });
  });
});
