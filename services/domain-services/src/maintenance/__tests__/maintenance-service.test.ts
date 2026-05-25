/**
 * Unit tests for MaintenanceService
 */

import { describe, it, expect, vi } from 'vitest';
import type { TenantId, UserId } from '@borjie/domain-models';
import {
  type WorkOrder,
  type WorkOrderId,
  type PropertyId,
  type UnitId,
  type CustomerId,
  type VendorId,
  asPropertyId,
  asUnitId,
  asVendorId,
} from '@borjie/domain-models';
// asWorkOrderId is exported via the WorkOrder namespace (domain-models
// namespaces work-order.ts to avoid symbol collision with vendor.ts).
import { WorkOrder as WO } from '@borjie/domain-models';
const asWorkOrderId = WO.asWorkOrderId;
import type { WorkOrderRepository, VendorRepository, VendorEntity } from '../index.js';
import type { EventBus } from '../../common/events.js';
import {
  MaintenanceService,
  MaintenanceServiceError,
  type CreateWorkOrderInput,
  type AssignWorkOrderInput,
  type ScheduleWorkOrderInput,
  type CompleteWorkOrderInput,
} from '../index.js';

function createMockEventBus(): EventBus {
  return {
    publish: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn().mockReturnValue(() => {}),
  };
}

describe('MaintenanceService', () => {
  const tenantId = 'tnt_test' as TenantId;
  const userId = 'usr_1' as UserId;
  const correlationId = 'corr_123';

  describe('work order creation', () => {
    it('creates a work order successfully', async () => {
      const createInput: CreateWorkOrderInput = {
        propertyId: asPropertyId('prop_1'),
        unitId: asUnitId('unit_1'),
        priority: 'high',
        category: 'plumbing',
        source: 'customer_app',
        title: 'Leaking faucet',
        description: 'Kitchen faucet dripping constantly',
        location: 'Unit 101',
      };

      const mockWorkOrder = {
        id: asWorkOrderId('wo_1'),
        tenantId,
        workOrderNumber: 'WO-2025-00001',
        propertyId: createInput.propertyId,
        unitId: createInput.unitId,
        customerId: null,
        priority: 'high',
        category: 'plumbing',
        source: 'tenant',
        title: createInput.title,
        description: createInput.description,
        location: createInput.location,
        status: 'submitted',
        vendorId: null,
        assignedToUserId: null,
        sla: {
          submittedAt: new Date().toISOString(),
          responseDueAt: '',
          resolutionDueAt: '',
          responseBreached: false,
          resolutionBreached: false,
          pausedAt: null,
        },
        timeline: [],
        createdAt: '',
        updatedAt: '',
        createdBy: userId,
        updatedBy: userId,
      };

      const workOrderRepo: Partial<WorkOrderRepository> = {
        create: vi.fn().mockResolvedValue(mockWorkOrder),
        getNextSequence: vi.fn().mockResolvedValue(1),
      };

      const service = new MaintenanceService(
        workOrderRepo as WorkOrderRepository,
        {} as VendorRepository,
        createMockEventBus()
      );

      const result = await service.createWorkOrder(tenantId, createInput, userId, correlationId);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.title).toBe('Leaking faucet');
        expect(result.data.status).toBe('submitted');
      }
      expect(workOrderRepo.create).toHaveBeenCalled();
    });

    it('returns validation error when required fields missing', async () => {
      const createInput = {
        propertyId: asPropertyId('prop_1'),
        title: '',
        description: '',
        location: '',
        priority: 'high',
        category: 'plumbing',
        source: 'customer_app',
      } as CreateWorkOrderInput;

      const service = new MaintenanceService(
        {} as WorkOrderRepository,
        {} as VendorRepository,
        createMockEventBus()
      );

      const result = await service.createWorkOrder(tenantId, createInput, userId, correlationId);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(MaintenanceServiceError.INVALID_WORK_ORDER_DATA);
      }
    });
  });

  describe('assignment', () => {
    it('assigns work order to vendor successfully', async () => {
      const workOrder = {
        id: asWorkOrderId('wo_1'),
        tenantId,
        workOrderNumber: 'WO-2025-00001',
        propertyId: asPropertyId('prop_1'),
        unitId: asUnitId('unit_1'),
        status: 'triaged',
        priority: 'high',
        category: 'plumbing',
        vendorId: null,
        assignedToUserId: null,
        sla: {} as any,
        timeline: [],
        createdAt: '',
        updatedAt: '',
        createdBy: userId,
        updatedBy: userId,
      };

      const vendor = {
        id: asVendorId('vendor_1'),
        tenantId,
        vendorCode: 'VND-0001',
        companyName: 'Quick Fix Plumbing',
        status: 'active',
        specializations: ['plumbing'],
        serviceAreas: [],
        contacts: [],
        rateCards: [],
        performanceMetrics: {} as any,
        isPreferred: false,
        emergencyAvailable: false,
        licenseNumber: null,
        insuranceExpiryDate: null,
        notes: null,
        createdAt: '',
        updatedAt: '',
        createdBy: userId,
        updatedBy: userId,
      } as VendorEntity;

      const assignedWorkOrder = {
        ...workOrder,
        status: 'assigned',
        vendorId: vendor.id,
      };

      const workOrderRepo: Partial<WorkOrderRepository> = {
        findById: vi.fn().mockResolvedValue(workOrder),
        update: vi.fn().mockResolvedValue(assignedWorkOrder),
      };

      const vendorRepo: Partial<VendorRepository> = {
        findById: vi.fn().mockResolvedValue(vendor),
      };

      const service = new MaintenanceService(
        workOrderRepo as WorkOrderRepository,
        vendorRepo as VendorRepository,
        createMockEventBus()
      );

      const assignInput: AssignWorkOrderInput = {
        vendorId: vendor.id,
        notes: 'Assigned to Quick Fix',
      };

      const result = await service.assign(
        workOrder.id,
        tenantId,
        assignInput,
        userId,
        correlationId
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.vendorId).toBe(vendor.id);
      }
      expect(workOrderRepo.update).toHaveBeenCalled();
      expect(vendorRepo.findById).toHaveBeenCalledWith(vendor.id, tenantId);
    });

    it('returns error when vendor not found', async () => {
      const workOrder = {
        id: asWorkOrderId('wo_1'),
        tenantId,
        status: 'triaged',
        vendorId: null,
        sla: {} as any,
        timeline: [],
      } as WorkOrder;

      const workOrderRepo: Partial<WorkOrderRepository> = {
        findById: vi.fn().mockResolvedValue(workOrder),
      };

      const vendorRepo: Partial<VendorRepository> = {
        findById: vi.fn().mockResolvedValue(null),
      };

      const service = new MaintenanceService(
        workOrderRepo as WorkOrderRepository,
        vendorRepo as VendorRepository,
        createMockEventBus()
      );

      const result = await service.assign(
        workOrder.id,
        tenantId,
        { vendorId: asVendorId('vendor_nonexistent') },
        userId,
        correlationId
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(MaintenanceServiceError.VENDOR_NOT_FOUND);
      }
    });
  });

  describe('SLA tracking', () => {
    it('pauses SLA successfully', async () => {
      const workOrder = {
        id: asWorkOrderId('wo_1'),
        tenantId,
        status: 'assigned',
        sla: {
          submittedAt: '',
          responseDueAt: '',
          resolutionDueAt: '',
          responseBreached: false,
          resolutionBreached: false,
          pausedAt: null,
        },
        timeline: [],
        createdAt: '',
        updatedAt: '',
        createdBy: userId,
        updatedBy: userId,
      } as WorkOrder;

      const pausedWorkOrder = {
        ...workOrder,
        sla: { ...workOrder.sla, pausedAt: new Date().toISOString() },
      };

      const workOrderRepo: Partial<WorkOrderRepository> = {
        findById: vi.fn().mockResolvedValue(workOrder),
        update: vi.fn().mockResolvedValue(pausedWorkOrder),
      };

      const service = new MaintenanceService(
        workOrderRepo as WorkOrderRepository,
        {} as VendorRepository,
        createMockEventBus()
      );

      const result = await service.pauseSLA(
        workOrder.id,
        tenantId,
        'Waiting for parts',
        userId,
        correlationId
      );

      expect(result.success).toBe(true);
      expect(workOrderRepo.update).toHaveBeenCalled();
    });

    it('returns error when SLA already paused', async () => {
      const workOrder = {
        id: asWorkOrderId('wo_1'),
        tenantId,
        sla: {
          submittedAt: '',
          responseDueAt: '',
          resolutionDueAt: '',
          responseBreached: false,
          resolutionBreached: false,
          pausedAt: new Date().toISOString(),
        },
        timeline: [],
      } as WorkOrder;

      const workOrderRepo: Partial<WorkOrderRepository> = {
        findById: vi.fn().mockResolvedValue(workOrder),
      };

      const service = new MaintenanceService(
        workOrderRepo as WorkOrderRepository,
        {} as VendorRepository,
        createMockEventBus()
      );

      const result = await service.pauseSLA(
        workOrder.id,
        tenantId,
        'Reason',
        userId,
        correlationId
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(MaintenanceServiceError.SLA_ALREADY_PAUSED);
      }
    });
  });

  describe('completion flow', () => {
    it('completes a work order successfully', async () => {
      const workOrder = {
        id: asWorkOrderId('wo_1'),
        tenantId,
        workOrderNumber: 'WO-2025-00001',
        propertyId: asPropertyId('prop_1'),
        unitId: asUnitId('unit_1'),
        status: 'in_progress',
        priority: 'high',
        category: 'plumbing',
        sla: {
          submittedAt: new Date().toISOString(),
          responseDueAt: '',
          resolutionDueAt: '',
          responseBreached: false,
          resolutionBreached: false,
          resolvedAt: null,
          pausedAt: null,
        },
        timeline: [],
        createdAt: '',
        updatedAt: '',
        createdBy: userId,
        updatedBy: userId,
      } as WorkOrder;

      const completedWorkOrder = {
        ...workOrder,
        status: 'completed',
        sla: {
          ...workOrder.sla,
          resolvedAt: new Date().toISOString(),
        },
      };

      const workOrderRepo: Partial<WorkOrderRepository> = {
        findById: vi.fn().mockResolvedValue(workOrder),
        update: vi.fn().mockResolvedValue(completedWorkOrder),
      };

      const service = new MaintenanceService(
        workOrderRepo as WorkOrderRepository,
        {} as VendorRepository,
        createMockEventBus()
      );

      const completeInput: CompleteWorkOrderInput = {
        completionNotes: 'Faucet replaced successfully',
      };

      const result = await service.complete(
        workOrder.id,
        tenantId,
        completeInput,
        userId,
        correlationId
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.status).toBe('completed');
      }
      expect(workOrderRepo.update).toHaveBeenCalled();
    });

    it('returns error when work order cannot be completed from current status', async () => {
      const workOrder = {
        id: asWorkOrderId('wo_1'),
        tenantId,
        status: 'submitted',
        sla: {} as any,
        timeline: [],
      } as WorkOrder;

      const workOrderRepo: Partial<WorkOrderRepository> = {
        findById: vi.fn().mockResolvedValue(workOrder),
      };

      const service = new MaintenanceService(
        workOrderRepo as WorkOrderRepository,
        {} as VendorRepository,
        createMockEventBus()
      );

      const result = await service.complete(
        workOrder.id,
        tenantId,
        { completionNotes: 'Done' },
        userId,
        correlationId
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(MaintenanceServiceError.INVALID_STATUS_TRANSITION);
      }
    });
  });
});
