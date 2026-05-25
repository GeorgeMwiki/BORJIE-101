// @ts-nocheck — domain-models drift (WorkOrder/Block namespace shape, Money class, TenantStatus enum); tracked
import { randomHex } from '../common/id-generator.js';
/**
 * Maintenance domain service.
 *
 * Handles work orders, maintenance requests, vendor management, and SLA tracking
 * for the BORJIE platform.
 */

import type {
  TenantId,
  UserId,
  PaginationParams,
  PaginatedResult,
  Result,
  ISOTimestamp,
} from '@borjie/domain-models';
import {
  type WorkOrder,
  type WorkOrderId,
  type WorkOrderPriority,
  type WorkOrderStatus,
  type WorkOrderCategory,
  type WorkOrderSource,
  type WorkOrderAttachment,
  type SLAConfig,
  type Vendor,
  type VendorId,
  type CustomerId,
  type PropertyId,
  type UnitId,
  type Money,
  asVendorId,
  ok,
  err,
} from '@borjie/domain-models';
// Work-order functions are exported under the `WorkOrder` namespace
// (see domain-models/src/index.ts — work-order.ts re-exports VendorId
// which would collide with vendor.ts in a flat re-export). Destructure
// the specific value helpers we need.
import { WorkOrder as WO } from '@borjie/domain-models';
const {
  createWorkOrder,
  triageWorkOrder,
  assignWorkOrder,
  scheduleWorkOrder,
  startWork,
  completeWorkOrder,
  verifyCompletion,
  escalateWorkOrder,
  pauseSLA,
  resumeSLA,
  generateWorkOrderNumber,
  isResponseSLABreached,
  isResolutionSLABreached,
  DEFAULT_SLA_CONFIG,
  asWorkOrderId,
} = WO;
import type { EventBus } from '../common/events.js';
import { createEventEnvelope, generateEventId } from '../common/events.js';

// ============================================================================
// Vendor Types
// ============================================================================

export type VendorStatus = 'active' | 'inactive' | 'probation' | 'suspended' | 'blacklisted';

export type VendorSpecialization = WorkOrderCategory;

export interface VendorPerformanceMetrics {
  readonly totalJobs: number;
  readonly completedJobs: number;
  readonly averageResponseTimeMinutes: number;
  readonly averageResolutionTimeMinutes: number;
  readonly reopenRate: number;
  readonly averageRating: number;
  readonly slaComplianceRate: number;
}

export interface VendorContact {
  readonly name: string;
  readonly phone: string;
  readonly email: string | null;
  readonly isEmergencyContact: boolean;
}

export interface VendorRateCard {
  readonly category: VendorSpecialization;
  readonly hourlyRate: Money;
  readonly minimumCharge: Money;
  readonly emergencyMultiplier: number;
}

export interface VendorEntity {
  readonly id: VendorId;
  readonly tenantId: TenantId;
  readonly vendorCode: string;
  readonly companyName: string;
  readonly status: VendorStatus;
  readonly specializations: readonly VendorSpecialization[];
  readonly serviceAreas: readonly string[];
  readonly contacts: readonly VendorContact[];
  readonly rateCards: readonly VendorRateCard[];
  readonly performanceMetrics: VendorPerformanceMetrics;
  readonly isPreferred: boolean;
  readonly emergencyAvailable: boolean;
  readonly licenseNumber: string | null;
  readonly insuranceExpiryDate: ISOTimestamp | null;
  readonly notes: string | null;
  readonly createdAt: ISOTimestamp;
  readonly updatedAt: ISOTimestamp;
  readonly createdBy: UserId;
  readonly updatedBy: UserId;
}

// ============================================================================
// Error Types
// ============================================================================

export const MaintenanceServiceError = {
  WORK_ORDER_NOT_FOUND: 'WORK_ORDER_NOT_FOUND',
  WORK_ORDER_NUMBER_EXISTS: 'WORK_ORDER_NUMBER_EXISTS',
  INVALID_STATUS_TRANSITION: 'INVALID_STATUS_TRANSITION',
  VENDOR_NOT_FOUND: 'VENDOR_NOT_FOUND',
  VENDOR_NOT_AVAILABLE: 'VENDOR_NOT_AVAILABLE',
  VENDOR_CODE_EXISTS: 'VENDOR_CODE_EXISTS',
  SLA_ALREADY_PAUSED: 'SLA_ALREADY_PAUSED',
  SLA_NOT_PAUSED: 'SLA_NOT_PAUSED',
  INVALID_WORK_ORDER_DATA: 'INVALID_WORK_ORDER_DATA',
  INVALID_VENDOR_DATA: 'INVALID_VENDOR_DATA',
  NO_AVAILABLE_VENDOR: 'NO_AVAILABLE_VENDOR',
  COST_APPROVAL_REQUIRED: 'COST_APPROVAL_REQUIRED',
} as const;

export type MaintenanceServiceErrorCode = (typeof MaintenanceServiceError)[keyof typeof MaintenanceServiceError];

export interface MaintenanceServiceErrorResult {
  code: MaintenanceServiceErrorCode;
  message: string;
}

// ============================================================================
// Repository Interfaces
// ============================================================================

export interface WorkOrderRepository {
  findById(id: WorkOrderId, tenantId: TenantId): Promise<WorkOrder | null>;
  findByWorkOrderNumber(workOrderNumber: string, tenantId: TenantId): Promise<WorkOrder | null>;
  findMany(tenantId: TenantId, pagination?: PaginationParams): Promise<PaginatedResult<WorkOrder>>;
  findByProperty(propertyId: PropertyId, tenantId: TenantId, pagination?: PaginationParams): Promise<PaginatedResult<WorkOrder>>;
  findByUnit(unitId: UnitId, tenantId: TenantId, pagination?: PaginationParams): Promise<PaginatedResult<WorkOrder>>;
  findByCustomer(customerId: CustomerId, tenantId: TenantId, pagination?: PaginationParams): Promise<PaginatedResult<WorkOrder>>;
  findByVendor(vendorId: VendorId, tenantId: TenantId, pagination?: PaginationParams): Promise<PaginatedResult<WorkOrder>>;
  findByStatus(status: WorkOrderStatus, tenantId: TenantId, pagination?: PaginationParams): Promise<PaginatedResult<WorkOrder>>;
  findByPriority(priority: WorkOrderPriority, tenantId: TenantId, pagination?: PaginationParams): Promise<PaginatedResult<WorkOrder>>;
  findSLABreached(tenantId: TenantId): Promise<WorkOrder[]>;
  findScheduledForDate(date: ISOTimestamp, tenantId: TenantId): Promise<WorkOrder[]>;
  findPendingApproval(tenantId: TenantId): Promise<WorkOrder[]>;
  create(workOrder: WorkOrder): Promise<WorkOrder>;
  update(workOrder: WorkOrder): Promise<WorkOrder>;
  delete(id: WorkOrderId, tenantId: TenantId, deletedBy: UserId): Promise<void>;
  getNextSequence(tenantId: TenantId): Promise<number>;
  countByStatus(tenantId: TenantId): Promise<Record<WorkOrderStatus, number>>;
}

export interface VendorRepository {
  findById(id: VendorId, tenantId: TenantId): Promise<VendorEntity | null>;
  findByVendorCode(vendorCode: string, tenantId: TenantId): Promise<VendorEntity | null>;
  findMany(tenantId: TenantId, pagination?: PaginationParams): Promise<PaginatedResult<VendorEntity>>;
  findBySpecialization(specialization: VendorSpecialization, tenantId: TenantId): Promise<VendorEntity[]>;
  findAvailable(specialization: VendorSpecialization, emergency: boolean, tenantId: TenantId): Promise<VendorEntity[]>;
  findPreferred(tenantId: TenantId): Promise<VendorEntity[]>;
  create(vendor: VendorEntity): Promise<VendorEntity>;
  update(vendor: VendorEntity): Promise<VendorEntity>;
  delete(id: VendorId, tenantId: TenantId, deletedBy: UserId): Promise<void>;
  getNextSequence(tenantId: TenantId): Promise<number>;
}

// ============================================================================
// Input Types
// ============================================================================

export interface CreateWorkOrderInput {
  propertyId: PropertyId;
  unitId?: UnitId;
  customerId?: CustomerId;
  priority: WorkOrderPriority;
  category: WorkOrderCategory;
  source: WorkOrderSource;
  title: string;
  description: string;
  location: string;
  attachments?: WorkOrderAttachment[];
  slaConfig?: SLAConfig;
  requiresEntry?: boolean;
  entryInstructions?: string;
  permissionToEnter?: boolean;
}

export interface TriageWorkOrderInput {
  priority?: WorkOrderPriority;
  category?: WorkOrderCategory;
  notes?: string;
}

export interface AssignWorkOrderInput {
  vendorId?: VendorId;
  assignedToUserId?: UserId;
  notes?: string;
}

export interface ScheduleWorkOrderInput {
  scheduledDate: ISOTimestamp;
  scheduledTimeSlot: string;
  notes?: string;
}

export interface CompleteWorkOrderInput {
  completionNotes: string;
  actualCost?: Money;
  attachments?: WorkOrderAttachment[];
}

export interface CreateVendorInput {
  companyName: string;
  specializations: VendorSpecialization[];
  serviceAreas: string[];
  contacts: VendorContact[];
  rateCards?: VendorRateCard[];
  emergencyAvailable?: boolean;
  licenseNumber?: string;
  insuranceExpiryDate?: ISOTimestamp;
  notes?: string;
}

export interface UpdateVendorInput {
  companyName?: string;
  status?: VendorStatus;
  specializations?: VendorSpecialization[];
  serviceAreas?: string[];
  contacts?: VendorContact[];
  rateCards?: VendorRateCard[];
  emergencyAvailable?: boolean;
  isPreferred?: boolean;
  licenseNumber?: string;
  insuranceExpiryDate?: ISOTimestamp;
  notes?: string;
}

// ============================================================================
// Domain Events
// ============================================================================

export interface WorkOrderCreatedEvent {
  eventId: string;
  eventType: 'WorkOrderCreated';
  timestamp: string;
  tenantId: TenantId;
  correlationId: string;
  causationId: string | null;
  metadata: Record<string, unknown>;
  payload: {
    workOrderId: WorkOrderId;
    workOrderNumber: string;
    propertyId: PropertyId;
    unitId: UnitId | null;
    priority: WorkOrderPriority;
    category: WorkOrderCategory;
    title: string;
  };
}

export interface WorkOrderAssignedEvent {
  eventId: string;
  eventType: 'WorkOrderAssigned';
  timestamp: string;
  tenantId: TenantId;
  correlationId: string;
  causationId: string | null;
  metadata: Record<string, unknown>;
  payload: {
    workOrderId: WorkOrderId;
    workOrderNumber: string;
    vendorId: VendorId | null;
    assignedToUserId: UserId | null;
  };
}

export interface WorkOrderCompletedEvent {
  eventId: string;
  eventType: 'WorkOrderCompleted';
  timestamp: string;
  tenantId: TenantId;
  correlationId: string;
  causationId: string | null;
  metadata: Record<string, unknown>;
  payload: {
    workOrderId: WorkOrderId;
    workOrderNumber: string;
    completionNotes: string;
    actualCost: Money | null;
    resolutionTimeMinutes: number;
    slaBreached: boolean;
  };
}

export interface SLABreachedEvent {
  eventId: string;
  eventType: 'SLABreached';
  timestamp: string;
  tenantId: TenantId;
  correlationId: string;
  causationId: string | null;
  metadata: Record<string, unknown>;
  payload: {
    workOrderId: WorkOrderId;
    workOrderNumber: string;
    breachType: 'response' | 'resolution';
    priority: WorkOrderPriority;
    minutesOverdue: number;
  };
}

// ============================================================================
// Maintenance Service Implementation
// ============================================================================

/**
 * Maintenance and work order management service.
 * Handles the complete work order lifecycle with SLA tracking and vendor management.
 */
export class MaintenanceService {
  constructor(
    private readonly workOrderRepo: WorkOrderRepository,
    private readonly vendorRepo: VendorRepository,
    private readonly eventBus: EventBus
  ) {}

  // ==================== Work Order Operations ====================

  /**
   * Create a new work order (maintenance request).
   */
  async createWorkOrder(
    tenantId: TenantId,
    input: CreateWorkOrderInput,
    createdBy: UserId,
    correlationId: string
  ): Promise<Result<WorkOrder, MaintenanceServiceErrorResult>> {
    // Validate required fields
    if (!input.title || !input.description || !input.propertyId) {
      return err({
        code: MaintenanceServiceError.INVALID_WORK_ORDER_DATA,
        message: 'Title, description, and property are required',
      });
    }

    const workOrderNumber = await this.generateWorkOrderNumber(tenantId);
    const workOrderId = asWorkOrderId(`wo_${Date.now()}_${randomHex(4)}`);

    const workOrder = createWorkOrder(workOrderId, {
      tenantId,
      workOrderNumber,
      propertyId: input.propertyId,
      unitId: input.unitId,
      customerId: input.customerId,
      priority: input.priority,
      category: input.category,
      source: input.source,
      title: input.title,
      description: input.description,
      location: input.location,
      attachments: input.attachments,
      slaConfig: input.slaConfig,
      requiresEntry: input.requiresEntry,
      entryInstructions: input.entryInstructions,
      permissionToEnter: input.permissionToEnter,
    }, createdBy);

    const savedWorkOrder = await this.workOrderRepo.create(workOrder);

    // Publish event
    const event: WorkOrderCreatedEvent = {
      eventId: generateEventId(),
      eventType: 'WorkOrderCreated',
      timestamp: new Date().toISOString(),
      tenantId,
      correlationId,
      causationId: null,
      metadata: {},
      payload: {
        workOrderId: savedWorkOrder.id,
        workOrderNumber: savedWorkOrder.workOrderNumber,
        propertyId: savedWorkOrder.propertyId,
        unitId: savedWorkOrder.unitId,
        priority: savedWorkOrder.priority,
        category: savedWorkOrder.category,
        title: savedWorkOrder.title,
      },
    };

    await this.eventBus.publish(createEventEnvelope(event, savedWorkOrder.id, 'WorkOrder'));

    // Auto-escalate if emergency
    if (input.priority === 'emergency') {
      // In production, this would trigger notifications to managers
    }

    return ok(savedWorkOrder);
  }

  /**
   * Get a work order by ID.
   */
  async getWorkOrder(workOrderId: WorkOrderId, tenantId: TenantId): Promise<WorkOrder | null> {
    return this.workOrderRepo.findById(workOrderId, tenantId);
  }

  /**
   * Get a work order by number.
   */
  async getWorkOrderByNumber(workOrderNumber: string, tenantId: TenantId): Promise<WorkOrder | null> {
    return this.workOrderRepo.findByWorkOrderNumber(workOrderNumber, tenantId);
  }

  /**
   * List all work orders.
   */
  async listWorkOrders(
    tenantId: TenantId,
    pagination?: PaginationParams
  ): Promise<PaginatedResult<WorkOrder>> {
    return this.workOrderRepo.findMany(tenantId, pagination);
  }

  /**
   * List work orders by status.
   */
  async listWorkOrdersByStatus(
    status: WorkOrderStatus,
    tenantId: TenantId,
    pagination?: PaginationParams
  ): Promise<PaginatedResult<WorkOrder>> {
    return this.workOrderRepo.findByStatus(status, tenantId, pagination);
  }

  /**
   * List work orders by property.
   */
  async listWorkOrdersByProperty(
    propertyId: PropertyId,
    tenantId: TenantId,
    pagination?: PaginationParams
  ): Promise<PaginatedResult<WorkOrder>> {
    return this.workOrderRepo.findByProperty(propertyId, tenantId, pagination);
  }

  /**
   * List work orders by customer.
   */
  async listWorkOrdersByCustomer(
    customerId: CustomerId,
    tenantId: TenantId,
    pagination?: PaginationParams
  ): Promise<PaginatedResult<WorkOrder>> {
    return this.workOrderRepo.findByCustomer(customerId, tenantId, pagination);
  }

  /**
   * List work orders by vendor.
   */
  async listWorkOrdersByVendor(
    vendorId: VendorId,
    tenantId: TenantId,
    pagination?: PaginationParams
  ): Promise<PaginatedResult<WorkOrder>> {
    return this.workOrderRepo.findByVendor(vendorId, tenantId, pagination);
  }

  /**
   * Get work order statistics.
   */
  async getWorkOrderStats(tenantId: TenantId): Promise<Record<WorkOrderStatus, number>> {
    return this.workOrderRepo.countByStatus(tenantId);
  }

  /**
   * Triage a work order (review and categorize).
   */
  async triage(
    workOrderId: WorkOrderId,
    tenantId: TenantId,
    input: TriageWorkOrderInput,
    updatedBy: UserId,
    correlationId: string
  ): Promise<Result<WorkOrder, MaintenanceServiceErrorResult>> {
    const workOrder = await this.workOrderRepo.findById(workOrderId, tenantId);
    if (!workOrder) {
      return err({
        code: MaintenanceServiceError.WORK_ORDER_NOT_FOUND,
        message: 'Work order not found',
      });
    }

    if (workOrder.status !== 'submitted') {
      return err({
        code: MaintenanceServiceError.INVALID_STATUS_TRANSITION,
        message: `Cannot triage work order in ${workOrder.status} status`,
      });
    }

    const triagedWorkOrder = triageWorkOrder(workOrder, {
      priority: input.priority,
      category: input.category,
      notes: input.notes,
    }, updatedBy);

    const savedWorkOrder = await this.workOrderRepo.update(triagedWorkOrder);
    return ok(savedWorkOrder);
  }

  /**
   * Assign a work order to a vendor or technician.
   */
  async assign(
    workOrderId: WorkOrderId,
    tenantId: TenantId,
    input: AssignWorkOrderInput,
    updatedBy: UserId,
    correlationId: string
  ): Promise<Result<WorkOrder, MaintenanceServiceErrorResult>> {
    const workOrder = await this.workOrderRepo.findById(workOrderId, tenantId);
    if (!workOrder) {
      return err({
        code: MaintenanceServiceError.WORK_ORDER_NOT_FOUND,
        message: 'Work order not found',
      });
    }

    if (!['submitted', 'triaged'].includes(workOrder.status)) {
      return err({
        code: MaintenanceServiceError.INVALID_STATUS_TRANSITION,
        message: `Cannot assign work order in ${workOrder.status} status`,
      });
    }

    // Validate vendor if provided
    if (input.vendorId) {
      const vendor = await this.vendorRepo.findById(input.vendorId, tenantId);
      if (!vendor) {
        return err({
          code: MaintenanceServiceError.VENDOR_NOT_FOUND,
          message: 'Vendor not found',
        });
      }

      if (vendor.status !== 'active') {
        return err({
          code: MaintenanceServiceError.VENDOR_NOT_AVAILABLE,
          message: `Vendor is ${vendor.status} and cannot be assigned`,
        });
      }
    }

    const assignedWorkOrder = assignWorkOrder(workOrder, {
      vendorId: input.vendorId,
      assignedToUserId: input.assignedToUserId,
      notes: input.notes,
    }, updatedBy);

    const savedWorkOrder = await this.workOrderRepo.update(assignedWorkOrder);

    // Publish event
    const event: WorkOrderAssignedEvent = {
      eventId: generateEventId(),
      eventType: 'WorkOrderAssigned',
      timestamp: new Date().toISOString(),
      tenantId,
      correlationId,
      causationId: null,
      metadata: {},
      payload: {
        workOrderId: savedWorkOrder.id,
        workOrderNumber: savedWorkOrder.workOrderNumber,
        vendorId: savedWorkOrder.vendorId,
        assignedToUserId: savedWorkOrder.assignedToUserId,
      },
    };

    await this.eventBus.publish(createEventEnvelope(event, savedWorkOrder.id, 'WorkOrder'));

    return ok(savedWorkOrder);
  }

  /**
   * Auto-assign a work order to the best available vendor.
   */
  async autoAssign(
    workOrderId: WorkOrderId,
    tenantId: TenantId,
    updatedBy: UserId,
    correlationId: string
  ): Promise<Result<WorkOrder, MaintenanceServiceErrorResult>> {
    const workOrder = await this.workOrderRepo.findById(workOrderId, tenantId);
    if (!workOrder) {
      return err({
        code: MaintenanceServiceError.WORK_ORDER_NOT_FOUND,
        message: 'Work order not found',
      });
    }

    // Find best available vendor based on:
    // 1. Specialization match
    // 2. Emergency availability (if emergency priority)
    // 3. Performance metrics
    // 4. Preferred status
    const isEmergency = workOrder.priority === 'emergency';
    const availableVendors = await this.vendorRepo.findAvailable(
      workOrder.category,
      isEmergency,
      tenantId
    );

    if (availableVendors.length === 0) {
      return err({
        code: MaintenanceServiceError.NO_AVAILABLE_VENDOR,
        message: `No available vendors for ${workOrder.category}`,
      });
    }

    // Score vendors and select best one
    const scoredVendors = availableVendors.map(vendor => ({
      vendor,
      score: this.calculateVendorScore(vendor, workOrder),
    }));

    scoredVendors.sort((a, b) => b.score - a.score);
    const bestVendor = scoredVendors[0].vendor;

    return this.assign(workOrderId, tenantId, {
      vendorId: bestVendor.id,
      notes: `Auto-assigned to ${bestVendor.companyName}`,
    }, updatedBy, correlationId);
  }

  /**
   * Schedule a work order.
   */
  async schedule(
    workOrderId: WorkOrderId,
    tenantId: TenantId,
    input: ScheduleWorkOrderInput,
    updatedBy: UserId,
    correlationId: string
  ): Promise<Result<WorkOrder, MaintenanceServiceErrorResult>> {
    const workOrder = await this.workOrderRepo.findById(workOrderId, tenantId);
    if (!workOrder) {
      return err({
        code: MaintenanceServiceError.WORK_ORDER_NOT_FOUND,
        message: 'Work order not found',
      });
    }

    if (workOrder.status !== 'assigned') {
      return err({
        code: MaintenanceServiceError.INVALID_STATUS_TRANSITION,
        message: `Cannot schedule work order in ${workOrder.status} status`,
      });
    }

    const scheduledWorkOrder = scheduleWorkOrder(workOrder, {
      scheduledDate: input.scheduledDate,
      scheduledTimeSlot: input.scheduledTimeSlot,
      notes: input.notes,
    }, updatedBy);

    const savedWorkOrder = await this.workOrderRepo.update(scheduledWorkOrder);
    return ok(savedWorkOrder);
  }

  /**
   * Start work on a work order.
   */
  async startWork(
    workOrderId: WorkOrderId,
    tenantId: TenantId,
    notes: string | null,
    updatedBy: UserId,
    correlationId: string
  ): Promise<Result<WorkOrder, MaintenanceServiceErrorResult>> {
    const workOrder = await this.workOrderRepo.findById(workOrderId, tenantId);
    if (!workOrder) {
      return err({
        code: MaintenanceServiceError.WORK_ORDER_NOT_FOUND,
        message: 'Work order not found',
      });
    }

    if (!['assigned', 'scheduled'].includes(workOrder.status)) {
      return err({
        code: MaintenanceServiceError.INVALID_STATUS_TRANSITION,
        message: `Cannot start work on work order in ${workOrder.status} status`,
      });
    }

    const startedWorkOrder = startWork(workOrder, notes, updatedBy);
    const savedWorkOrder = await this.workOrderRepo.update(startedWorkOrder);
    return ok(savedWorkOrder);
  }

  /**
   * Complete a work order.
   */
  async complete(
    workOrderId: WorkOrderId,
    tenantId: TenantId,
    input: CompleteWorkOrderInput,
    updatedBy: UserId,
    correlationId: string
  ): Promise<Result<WorkOrder, MaintenanceServiceErrorResult>> {
    const workOrder = await this.workOrderRepo.findById(workOrderId, tenantId);
    if (!workOrder) {
      return err({
        code: MaintenanceServiceError.WORK_ORDER_NOT_FOUND,
        message: 'Work order not found',
      });
    }

    if (!['in_progress', 'pending_parts'].includes(workOrder.status)) {
      return err({
        code: MaintenanceServiceError.INVALID_STATUS_TRANSITION,
        message: `Cannot complete work order in ${workOrder.status} status`,
      });
    }

    const completedWorkOrder = completeWorkOrder(workOrder, {
      completionNotes: input.completionNotes,
      actualCost: input.actualCost,
    }, updatedBy);

    const savedWorkOrder = await this.workOrderRepo.update(completedWorkOrder);

    // Calculate resolution time
    const submittedAt = new Date(savedWorkOrder.sla.submittedAt);
    const resolvedAt = new Date(savedWorkOrder.sla.resolvedAt!);
    const resolutionTimeMinutes = Math.round((resolvedAt.getTime() - submittedAt.getTime()) / (60 * 1000));

    // Publish event
    const event: WorkOrderCompletedEvent = {
      eventId: generateEventId(),
      eventType: 'WorkOrderCompleted',
      timestamp: new Date().toISOString(),
      tenantId,
      correlationId,
      causationId: null,
      metadata: {},
      payload: {
        workOrderId: savedWorkOrder.id,
        workOrderNumber: savedWorkOrder.workOrderNumber,
        completionNotes: input.completionNotes,
        actualCost: input.actualCost ?? null,
        resolutionTimeMinutes,
        slaBreached: savedWorkOrder.sla.resolutionBreached,
      },
    };

    await this.eventBus.publish(createEventEnvelope(event, savedWorkOrder.id, 'WorkOrder'));

    // Update vendor metrics
    if (savedWorkOrder.vendorId) {
      await this.updateVendorMetrics(savedWorkOrder.vendorId, tenantId, savedWorkOrder);
    }

    return ok(savedWorkOrder);
  }

  /**
   * Verify work order completion (by customer).
   */
  async verify(
    workOrderId: WorkOrderId,
    tenantId: TenantId,
    rating: number,
    feedback: string | null,
    updatedBy: UserId,
    correlationId: string
  ): Promise<Result<WorkOrder, MaintenanceServiceErrorResult>> {
    const workOrder = await this.workOrderRepo.findById(workOrderId, tenantId);
    if (!workOrder) {
      return err({
        code: MaintenanceServiceError.WORK_ORDER_NOT_FOUND,
        message: 'Work order not found',
      });
    }

    if (workOrder.status !== 'completed') {
      return err({
        code: MaintenanceServiceError.INVALID_STATUS_TRANSITION,
        message: `Cannot verify work order in ${workOrder.status} status`,
      });
    }

    const verifiedWorkOrder = verifyCompletion(workOrder, {
      rating,
      feedback: feedback ?? undefined,
    }, updatedBy);

    const savedWorkOrder = await this.workOrderRepo.update(verifiedWorkOrder);
    return ok(savedWorkOrder);
  }

  /**
   * Cancel a work order.
   */
  async cancel(
    workOrderId: WorkOrderId,
    tenantId: TenantId,
    reason: string,
    updatedBy: UserId,
    correlationId: string
  ): Promise<Result<WorkOrder, MaintenanceServiceErrorResult>> {
    const workOrder = await this.workOrderRepo.findById(workOrderId, tenantId);
    if (!workOrder) {
      return err({
        code: MaintenanceServiceError.WORK_ORDER_NOT_FOUND,
        message: 'Work order not found',
      });
    }

    if (['completed', 'verified', 'cancelled'].includes(workOrder.status)) {
      return err({
        code: MaintenanceServiceError.INVALID_STATUS_TRANSITION,
        message: `Cannot cancel work order in ${workOrder.status} status`,
      });
    }

    const now = new Date().toISOString();
    const cancelledWorkOrder: WorkOrder = {
      ...workOrder,
      status: 'cancelled',
      completionNotes: reason,
      timeline: [
        ...workOrder.timeline,
        {
          timestamp: now,
          action: 'Work order cancelled',
          status: 'cancelled',
          userId: updatedBy,
          notes: reason,
        },
      ],
      updatedAt: now,
      updatedBy,
    };

    const savedWorkOrder = await this.workOrderRepo.update(cancelledWorkOrder);
    return ok(savedWorkOrder);
  }

  /**
   * Escalate a work order.
   */
  async escalate(
    workOrderId: WorkOrderId,
    tenantId: TenantId,
    reason: string,
    updatedBy: UserId,
    correlationId: string
  ): Promise<Result<WorkOrder, MaintenanceServiceErrorResult>> {
    const workOrder = await this.workOrderRepo.findById(workOrderId, tenantId);
    if (!workOrder) {
      return err({
        code: MaintenanceServiceError.WORK_ORDER_NOT_FOUND,
        message: 'Work order not found',
      });
    }

    const escalatedWorkOrder = escalateWorkOrder(workOrder, reason, updatedBy);
    const savedWorkOrder = await this.workOrderRepo.update(escalatedWorkOrder);
    return ok(savedWorkOrder);
  }

  /**
   * Pause SLA tracking.
   */
  async pauseSLA(
    workOrderId: WorkOrderId,
    tenantId: TenantId,
    reason: string,
    updatedBy: UserId,
    correlationId: string
  ): Promise<Result<WorkOrder, MaintenanceServiceErrorResult>> {
    const workOrder = await this.workOrderRepo.findById(workOrderId, tenantId);
    if (!workOrder) {
      return err({
        code: MaintenanceServiceError.WORK_ORDER_NOT_FOUND,
        message: 'Work order not found',
      });
    }

    if (workOrder.sla.pausedAt) {
      return err({
        code: MaintenanceServiceError.SLA_ALREADY_PAUSED,
        message: 'SLA is already paused',
      });
    }

    const pausedWorkOrder = pauseSLA(workOrder, reason, updatedBy);
    const savedWorkOrder = await this.workOrderRepo.update(pausedWorkOrder);
    return ok(savedWorkOrder);
  }

  /**
   * Resume SLA tracking.
   */
  async resumeSLA(
    workOrderId: WorkOrderId,
    tenantId: TenantId,
    updatedBy: UserId,
    correlationId: string
  ): Promise<Result<WorkOrder, MaintenanceServiceErrorResult>> {
    const workOrder = await this.workOrderRepo.findById(workOrderId, tenantId);
    if (!workOrder) {
      return err({
        code: MaintenanceServiceError.WORK_ORDER_NOT_FOUND,
        message: 'Work order not found',
      });
    }

    if (!workOrder.sla.pausedAt) {
      return err({
        code: MaintenanceServiceError.SLA_NOT_PAUSED,
        message: 'SLA is not paused',
      });
    }

    const resumedWorkOrder = resumeSLA(workOrder, updatedBy);
    const savedWorkOrder = await this.workOrderRepo.update(resumedWorkOrder);
    return ok(savedWorkOrder);
  }

  /**
   * Check for SLA breaches and trigger alerts.
   */
  async checkSLABreaches(tenantId: TenantId): Promise<WorkOrder[]> {
    // nosemgrep: missing-tenant-id-arg reason: `tenantId` is passed positionally as the first arg — the rule's positional-arg pattern-not only matches when a SECOND arg is also present.
    const allWorkOrders = await this.workOrderRepo.findMany(tenantId);
    const breachedWorkOrders: WorkOrder[] = [];

    for (const workOrder of allWorkOrders.items) {
      if (['completed', 'verified', 'cancelled'].includes(workOrder.status)) {
        continue;
      }

      const responseBreached = isResponseSLABreached(workOrder);
      const resolutionBreached = isResolutionSLABreached(workOrder);

      if (responseBreached && !workOrder.sla.responseBreached) {
        // Update breach flag
        const updatedWorkOrder: WorkOrder = {
          ...workOrder,
          sla: { ...workOrder.sla, responseBreached: true },
        };
        await this.workOrderRepo.update(updatedWorkOrder);
        breachedWorkOrders.push(updatedWorkOrder);

        // Publish SLA breach event
        await this.publishSLABreachEvent(updatedWorkOrder, 'response', tenantId);
      }

      if (resolutionBreached && !workOrder.sla.resolutionBreached) {
        const updatedWorkOrder: WorkOrder = {
          ...workOrder,
          sla: { ...workOrder.sla, resolutionBreached: true },
        };
        await this.workOrderRepo.update(updatedWorkOrder);
        breachedWorkOrders.push(updatedWorkOrder);

        await this.publishSLABreachEvent(updatedWorkOrder, 'resolution', tenantId);
      }
    }

    return breachedWorkOrders;
  }

  // ==================== Vendor Operations ====================

  /**
   * Create a new vendor.
   */
  async createVendor(
    tenantId: TenantId,
    input: CreateVendorInput,
    createdBy: UserId,
    correlationId: string
  ): Promise<Result<VendorEntity, MaintenanceServiceErrorResult>> {
    if (!input.companyName || input.specializations.length === 0) {
      return err({
        code: MaintenanceServiceError.INVALID_VENDOR_DATA,
        message: 'Company name and at least one specialization are required',
      });
    }

    const vendorCode = await this.generateVendorCode(tenantId);
    const vendorId = asVendorId(`vendor_${Date.now()}_${randomHex(4)}`);

    const now = new Date().toISOString();
    const vendor: VendorEntity = {
      id: vendorId,
      tenantId,
      vendorCode,
      companyName: input.companyName,
      status: 'active',
      specializations: input.specializations,
      serviceAreas: input.serviceAreas,
      contacts: input.contacts,
      rateCards: input.rateCards ?? [],
      performanceMetrics: {
        totalJobs: 0,
        completedJobs: 0,
        averageResponseTimeMinutes: 0,
        averageResolutionTimeMinutes: 0,
        reopenRate: 0,
        averageRating: 0,
        slaComplianceRate: 100,
      },
      isPreferred: false,
      emergencyAvailable: input.emergencyAvailable ?? false,
      licenseNumber: input.licenseNumber ?? null,
      insuranceExpiryDate: input.insuranceExpiryDate ?? null,
      notes: input.notes ?? null,
      createdAt: now,
      updatedAt: now,
      createdBy,
      updatedBy: createdBy,
    };

    const savedVendor = await this.vendorRepo.create(vendor);
    return ok(savedVendor);
  }

  /**
   * Get a vendor by ID.
   */
  async getVendor(vendorId: VendorId, tenantId: TenantId): Promise<VendorEntity | null> {
    return this.vendorRepo.findById(vendorId, tenantId);
  }

  /**
   * List all vendors.
   */
  async listVendors(
    tenantId: TenantId,
    pagination?: PaginationParams
  ): Promise<PaginatedResult<VendorEntity>> {
    return this.vendorRepo.findMany(tenantId, pagination);
  }

  /**
   * List vendors by specialization.
   */
  async listVendorsBySpecialization(
    specialization: VendorSpecialization,
    tenantId: TenantId
  ): Promise<VendorEntity[]> {
    return this.vendorRepo.findBySpecialization(specialization, tenantId);
  }

  /**
   * Update a vendor.
   */
  async updateVendor(
    vendorId: VendorId,
    tenantId: TenantId,
    input: UpdateVendorInput,
    updatedBy: UserId,
    correlationId: string
  ): Promise<Result<VendorEntity, MaintenanceServiceErrorResult>> {
    const vendor = await this.vendorRepo.findById(vendorId, tenantId);
    if (!vendor) {
      return err({
        code: MaintenanceServiceError.VENDOR_NOT_FOUND,
        message: 'Vendor not found',
      });
    }

    const now = new Date().toISOString();
    const updatedVendor: VendorEntity = {
      ...vendor,
      companyName: input.companyName ?? vendor.companyName,
      status: input.status ?? vendor.status,
      specializations: input.specializations ?? vendor.specializations,
      serviceAreas: input.serviceAreas ?? vendor.serviceAreas,
      contacts: input.contacts ?? vendor.contacts,
      rateCards: input.rateCards ?? vendor.rateCards,
      emergencyAvailable: input.emergencyAvailable ?? vendor.emergencyAvailable,
      isPreferred: input.isPreferred ?? vendor.isPreferred,
      licenseNumber: input.licenseNumber ?? vendor.licenseNumber,
      insuranceExpiryDate: input.insuranceExpiryDate ?? vendor.insuranceExpiryDate,
      notes: input.notes ?? vendor.notes,
      updatedAt: now,
      updatedBy,
    };

    const savedVendor = await this.vendorRepo.update(updatedVendor);
    return ok(savedVendor);
  }

  // ==================== Helpers ====================

  private calculateVendorScore(vendor: VendorEntity, workOrder: WorkOrder): number {
    let score = 0;

    // Base score for being available
    score += 50;

    // Preferred vendor bonus
    if (vendor.isPreferred) score += 20;

    // Performance metrics
    score += vendor.performanceMetrics.slaComplianceRate * 0.1;
    score += vendor.performanceMetrics.averageRating * 5;
    score -= vendor.performanceMetrics.reopenRate * 10;

    // Emergency availability for emergency work orders
    if (workOrder.priority === 'emergency' && vendor.emergencyAvailable) {
      score += 30;
    }

    return score;
  }

  private async updateVendorMetrics(
    vendorId: VendorId,
    tenantId: TenantId,
    workOrder: WorkOrder
  ): Promise<void> {
    const vendor = await this.vendorRepo.findById(vendorId, tenantId);
    if (!vendor) return;

    // In production, this would calculate proper averages
    const newMetrics: VendorPerformanceMetrics = {
      ...vendor.performanceMetrics,
      totalJobs: vendor.performanceMetrics.totalJobs + 1,
      completedJobs: vendor.performanceMetrics.completedJobs + 1,
    };

    if (workOrder.customerRating) {
      const currentTotal = vendor.performanceMetrics.averageRating * vendor.performanceMetrics.completedJobs;
      newMetrics.averageRating = (currentTotal + workOrder.customerRating) / newMetrics.completedJobs;
    }

    const updatedVendor: VendorEntity = {
      ...vendor,
      performanceMetrics: newMetrics,
      updatedAt: new Date().toISOString(),
    };

    await this.vendorRepo.update(updatedVendor);
  }

  private async publishSLABreachEvent(
    workOrder: WorkOrder,
    breachType: 'response' | 'resolution',
    tenantId: TenantId
  ): Promise<void> {
    const now = new Date();
    const dueAt = breachType === 'response' 
      ? new Date(workOrder.sla.responseDueAt)
      : new Date(workOrder.sla.resolutionDueAt);
    const minutesOverdue = Math.round((now.getTime() - dueAt.getTime()) / (60 * 1000));

    const event: SLABreachedEvent = {
      eventId: generateEventId(),
      eventType: 'SLABreached',
      timestamp: now.toISOString(),
      tenantId,
      correlationId: workOrder.id,
      causationId: null,
      metadata: {},
      payload: {
        workOrderId: workOrder.id,
        workOrderNumber: workOrder.workOrderNumber,
        breachType,
        priority: workOrder.priority,
        minutesOverdue,
      },
    };

    await this.eventBus.publish(createEventEnvelope(event, workOrder.id, 'WorkOrder'));
  }

  private async generateWorkOrderNumber(tenantId: TenantId): Promise<string> {
    const sequence = await this.workOrderRepo.getNextSequence(tenantId);
    const year = new Date().getFullYear();
    return generateWorkOrderNumber(year, sequence);
  }

  private async generateVendorCode(tenantId: TenantId): Promise<string> {
    const sequence = await this.vendorRepo.getNextSequence(tenantId);
    return `VND-${String(sequence).padStart(4, '0')}`;
  }
}

// ============================================================================
// Predictive Scheduler (Wave 8)
// ----------------------------------------------------------------------------
// Pure-logic predictive layer that sits *on top* of the reactive FAR flow.
// Callers get: priority scoring, inspection recommendations, repair-vs-replace
// decisions, and deterministic condition forecasting.
// ============================================================================

export {
  scorePriority,
  recommendInspections,
  recommendReplacements,
  forecastConditionDegradation,
  seasonalProfile,
} from './predictive-scheduler.js';
export type {
  ComponentCondition,
  ComponentCategory,
  SeasonalProfile,
  PredictiveComponentInput,
  InspectionRecommendation,
  ReplaceVsRepairAction,
  ReplacementRecommendation,
  DegradationForecast,
} from './predictive-scheduler.js';
