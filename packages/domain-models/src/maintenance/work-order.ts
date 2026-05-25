/**
 * Work Order domain model
 * Core maintenance request and work order management with SLA tracking
 */

import type { Brand, TenantId, UserId, EntityMetadata, ISOTimestamp } from '../common/types';
import type { Money } from '../common/money';
import type { CustomerId } from '../payments/payment-intent';
import type { PropertyId } from '../property/property';
import type { UnitId } from '../property/unit';

export type WorkOrderId = Brand<string, 'WorkOrderId'>;
export type VendorId = Brand<string, 'VendorId'>;

export function asWorkOrderId(id: string): WorkOrderId {
  return id as WorkOrderId;
}

export function asVendorId(id: string): VendorId {
  return id as VendorId;
}

/** Work order priority */
export type WorkOrderPriority = 'emergency' | 'high' | 'medium' | 'low';

/** Work order status */
export type WorkOrderStatus =
  | 'submitted'       // Customer submitted
  | 'triaged'         // Reviewed and categorized
  | 'assigned'        // Assigned to technician/vendor
  | 'scheduled'       // Appointment scheduled
  | 'in_progress'     // Work started
  | 'pending_parts'   // Waiting for parts
  | 'pending_approval'// Waiting for cost approval
  | 'completed'       // Work finished
  | 'verified'        // Customer verified completion
  | 'cancelled';      // Cancelled

/** Work order category */
export type WorkOrderCategory =
  | 'plumbing'
  | 'electrical'
  | 'hvac'
  | 'appliance'
  | 'structural'
  | 'pest_control'
  | 'landscaping'
  | 'cleaning'
  | 'security'
  | 'general'
  | 'other';

/** Work order source */
export type WorkOrderSource = 'customer_app' | 'manager_app' | 'inspection' | 'scheduled' | 'admin';

/** Attachment for work orders */
export interface WorkOrderAttachment {
  readonly id: string;
  readonly type: 'image' | 'video' | 'document';
  readonly url: string;
  readonly filename: string;
  readonly uploadedAt: ISOTimestamp;
  readonly uploadedBy: UserId;
}

/** Timeline entry for work order history */
export interface WorkOrderTimelineEntry {
  readonly timestamp: ISOTimestamp;
  readonly action: string;
  readonly status: WorkOrderStatus;
  readonly userId: UserId;
  readonly notes: string | null;
}

/**
 * SLA Configuration
 */
export interface SLAConfig {
  readonly responseTimeMinutes: number;    // Time to acknowledge
  readonly resolutionTimeMinutes: number;  // Time to complete
  readonly escalationAfterMinutes: number; // Time before auto-escalation
}

/** Default SLA configurations by priority */
export const DEFAULT_SLA_CONFIG: Record<WorkOrderPriority, SLAConfig> = {
  emergency: {
    responseTimeMinutes: 30,      // 30 minutes response
    resolutionTimeMinutes: 240,   // 4 hours resolution
    escalationAfterMinutes: 60,   // Escalate after 1 hour
  },
  high: {
    responseTimeMinutes: 120,     // 2 hours response
    resolutionTimeMinutes: 1440,  // 24 hours resolution
    escalationAfterMinutes: 240,  // Escalate after 4 hours
  },
  medium: {
    responseTimeMinutes: 480,     // 8 hours response
    resolutionTimeMinutes: 4320,  // 72 hours resolution
    escalationAfterMinutes: 1440, // Escalate after 24 hours
  },
  low: {
    responseTimeMinutes: 1440,    // 24 hours response
    resolutionTimeMinutes: 10080, // 7 days resolution
    escalationAfterMinutes: 2880, // Escalate after 48 hours
  },
};

/**
 * SLA Tracking
 */
export interface SLATracking {
  readonly config: SLAConfig;
  readonly submittedAt: ISOTimestamp;
  readonly respondedAt: ISOTimestamp | null;
  readonly resolvedAt: ISOTimestamp | null;
  readonly responseDueAt: ISOTimestamp;
  readonly resolutionDueAt: ISOTimestamp;
  readonly escalatedAt: ISOTimestamp | null;
  readonly escalationLevel: number;
  readonly responseBreached: boolean;
  readonly resolutionBreached: boolean;
  readonly pausedAt: ISOTimestamp | null;
  readonly pausedDurationMinutes: number;
  readonly pauseReason: string | null;
}

/**
 * Work Order entity
 */
export interface WorkOrder extends EntityMetadata {
  readonly id: WorkOrderId;
  readonly tenantId: TenantId;
  readonly workOrderNumber: string; // e.g., "WO-2024-0001"
  readonly propertyId: PropertyId;
  readonly unitId: UnitId | null; // Null for common area issues
  readonly customerId: CustomerId | null; // Null for proactive maintenance
  readonly status: WorkOrderStatus;
  readonly priority: WorkOrderPriority;
  readonly category: WorkOrderCategory;
  readonly source: WorkOrderSource;
  readonly title: string;
  readonly description: string;
  readonly location: string; // Specific location within unit/property
  readonly attachments: readonly WorkOrderAttachment[];
  readonly assignedToUserId: UserId | null; // Estate manager
  readonly vendorId: VendorId | null; // External vendor
  readonly scheduledDate: ISOTimestamp | null;
  readonly scheduledTimeSlot: string | null; // e.g., "09:00-12:00"
  readonly estimatedCost: Money | null;
  readonly actualCost: Money | null;
  readonly costApprovedAt: ISOTimestamp | null;
  readonly costApprovedBy: UserId | null;
  readonly completionNotes: string | null;
  readonly customerRating: number | null; // 1-5
  readonly customerFeedback: string | null;
  readonly sla: SLATracking;
  readonly timeline: readonly WorkOrderTimelineEntry[];
  readonly isRecurring: boolean;
  readonly recurringScheduleId: string | null;
  readonly requiresEntry: boolean; // Does technician need to enter unit?
  readonly entryInstructions: string | null;
  readonly permissionToEnter: boolean;
}

/** Create a new work order */
export function createWorkOrder(
  id: WorkOrderId,
  data: {
    tenantId: TenantId;
    workOrderNumber: string;
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
  },
  createdBy: UserId
): WorkOrder {
  const now = new Date().toISOString();
  const slaConfig = data.slaConfig ?? DEFAULT_SLA_CONFIG[data.priority];
  
  const submittedAt = new Date(now);
  const responseDueAt = new Date(submittedAt.getTime() + slaConfig.responseTimeMinutes * 60 * 1000);
  const resolutionDueAt = new Date(submittedAt.getTime() + slaConfig.resolutionTimeMinutes * 60 * 1000);

  const initialTimeline: WorkOrderTimelineEntry = {
    timestamp: now,
    action: 'Work order submitted',
    status: 'submitted',
    userId: createdBy,
    notes: null,
  };

  return {
    id,
    tenantId: data.tenantId,
    workOrderNumber: data.workOrderNumber,
    propertyId: data.propertyId,
    unitId: data.unitId ?? null,
    customerId: data.customerId ?? null,
    status: 'submitted',
    priority: data.priority,
    category: data.category,
    source: data.source,
    title: data.title,
    description: data.description,
    location: data.location,
    attachments: data.attachments ?? [],
    assignedToUserId: null,
    vendorId: null,
    scheduledDate: null,
    scheduledTimeSlot: null,
    estimatedCost: null,
    actualCost: null,
    costApprovedAt: null,
    costApprovedBy: null,
    completionNotes: null,
    customerRating: null,
    customerFeedback: null,
    sla: {
      config: slaConfig,
      submittedAt: now,
      respondedAt: null,
      resolvedAt: null,
      responseDueAt: responseDueAt.toISOString(),
      resolutionDueAt: resolutionDueAt.toISOString(),
      escalatedAt: null,
      escalationLevel: 0,
      responseBreached: false,
      resolutionBreached: false,
      pausedAt: null,
      pausedDurationMinutes: 0,
      pauseReason: null,
    },
    timeline: [initialTimeline],
    isRecurring: false,
    recurringScheduleId: null,
    requiresEntry: data.requiresEntry ?? true,
    entryInstructions: data.entryInstructions ?? null,
    permissionToEnter: data.permissionToEnter ?? false,
    createdAt: now,
    updatedAt: now,
    createdBy,
    updatedBy: createdBy,
  };
}

/** Triage work order */
export function triageWorkOrder(
  workOrder: WorkOrder,
  data: {
    priority?: WorkOrderPriority;
    category?: WorkOrderCategory;
    notes?: string;
  },
  updatedBy: UserId
): WorkOrder {
  const now = new Date().toISOString();
  const newPriority = data.priority ?? workOrder.priority;
  
  // Recalculate SLA if priority changed
  let sla = workOrder.sla;
  if (data.priority && data.priority !== workOrder.priority) {
    const newConfig = DEFAULT_SLA_CONFIG[newPriority];
    const submittedAt = new Date(sla.submittedAt);
    sla = {
      ...sla,
      config: newConfig,
      responseDueAt: new Date(submittedAt.getTime() + newConfig.responseTimeMinutes * 60 * 1000).toISOString(),
      resolutionDueAt: new Date(submittedAt.getTime() + newConfig.resolutionTimeMinutes * 60 * 1000).toISOString(),
      respondedAt: now, // Triage counts as response
    };
  } else {
    sla = {
      ...sla,
      respondedAt: sla.respondedAt ?? now,
    };
  }

  const timelineEntry: WorkOrderTimelineEntry = {
    timestamp: now,
    action: 'Work order triaged',
    status: 'triaged',
    userId: updatedBy,
    notes: data.notes ?? null,
  };

  return {
    ...workOrder,
    status: 'triaged',
    priority: newPriority,
    category: data.category ?? workOrder.category,
    sla,
    timeline: [...workOrder.timeline, timelineEntry],
    updatedAt: now,
    updatedBy,
  };
}

/** Assign work order */
export function assignWorkOrder(
  workOrder: WorkOrder,
  data: {
    assignedToUserId?: UserId;
    vendorId?: VendorId;
    notes?: string;
  },
  updatedBy: UserId
): WorkOrder {
  const now = new Date().toISOString();

  const timelineEntry: WorkOrderTimelineEntry = {
    timestamp: now,
    action: data.vendorId ? 'Assigned to vendor' : 'Assigned to technician',
    status: 'assigned',
    userId: updatedBy,
    notes: data.notes ?? null,
  };

  return {
    ...workOrder,
    status: 'assigned',
    assignedToUserId: data.assignedToUserId ?? workOrder.assignedToUserId,
    vendorId: data.vendorId ?? workOrder.vendorId,
    timeline: [...workOrder.timeline, timelineEntry],
    updatedAt: now,
    updatedBy,
  };
}

/** Schedule work order */
export function scheduleWorkOrder(
  workOrder: WorkOrder,
  data: {
    scheduledDate: ISOTimestamp;
    scheduledTimeSlot: string;
    notes?: string;
  },
  updatedBy: UserId
): WorkOrder {
  const now = new Date().toISOString();

  const timelineEntry: WorkOrderTimelineEntry = {
    timestamp: now,
    action: `Scheduled for ${data.scheduledDate} (${data.scheduledTimeSlot})`,
    status: 'scheduled',
    userId: updatedBy,
    notes: data.notes ?? null,
  };

  return {
    ...workOrder,
    status: 'scheduled',
    scheduledDate: data.scheduledDate,
    scheduledTimeSlot: data.scheduledTimeSlot,
    timeline: [...workOrder.timeline, timelineEntry],
    updatedAt: now,
    updatedBy,
  };
}

/** Start work on order */
export function startWork(
  workOrder: WorkOrder,
  notes: string | null,
  updatedBy: UserId
): WorkOrder {
  const now = new Date().toISOString();

  const timelineEntry: WorkOrderTimelineEntry = {
    timestamp: now,
    action: 'Work started',
    status: 'in_progress',
    userId: updatedBy,
    notes,
  };

  return {
    ...workOrder,
    status: 'in_progress',
    timeline: [...workOrder.timeline, timelineEntry],
    updatedAt: now,
    updatedBy,
  };
}

/** Complete work order */
export function completeWorkOrder(
  workOrder: WorkOrder,
  data: {
    completionNotes: string;
    actualCost?: Money;
  },
  updatedBy: UserId
): WorkOrder {
  const now = new Date().toISOString();

  // Check if resolution SLA was breached
  const resolutionBreached = new Date(now) > new Date(workOrder.sla.resolutionDueAt);

  const timelineEntry: WorkOrderTimelineEntry = {
    timestamp: now,
    action: 'Work completed',
    status: 'completed',
    userId: updatedBy,
    notes: data.completionNotes,
  };

  return {
    ...workOrder,
    status: 'completed',
    completionNotes: data.completionNotes,
    actualCost: data.actualCost ?? workOrder.actualCost,
    sla: {
      ...workOrder.sla,
      resolvedAt: now,
      resolutionBreached,
    },
    timeline: [...workOrder.timeline, timelineEntry],
    updatedAt: now,
    updatedBy,
  };
}

/** Customer verifies completion */
export function verifyCompletion(
  workOrder: WorkOrder,
  data: {
    rating: number;
    feedback?: string;
  },
  updatedBy: UserId
): WorkOrder {
  const now = new Date().toISOString();

  const timelineEntry: WorkOrderTimelineEntry = {
    timestamp: now,
    action: `Customer verified completion (Rating: ${data.rating}/5)`,
    status: 'verified',
    userId: updatedBy,
    notes: data.feedback ?? null,
  };

  return {
    ...workOrder,
    status: 'verified',
    customerRating: data.rating,
    customerFeedback: data.feedback ?? null,
    timeline: [...workOrder.timeline, timelineEntry],
    updatedAt: now,
    updatedBy,
  };
}

/** Escalate work order */
export function escalateWorkOrder(
  workOrder: WorkOrder,
  reason: string,
  updatedBy: UserId
): WorkOrder {
  const now = new Date().toISOString();

  const timelineEntry: WorkOrderTimelineEntry = {
    timestamp: now,
    action: `Escalated (Level ${workOrder.sla.escalationLevel + 1})`,
    status: workOrder.status,
    userId: updatedBy,
    notes: reason,
  };

  return {
    ...workOrder,
    sla: {
      ...workOrder.sla,
      escalatedAt: workOrder.sla.escalatedAt ?? now,
      escalationLevel: workOrder.sla.escalationLevel + 1,
    },
    timeline: [...workOrder.timeline, timelineEntry],
    updatedAt: now,
    updatedBy,
  };
}

/** Pause SLA (e.g., waiting for customer) */
export function pauseSLA(
  workOrder: WorkOrder,
  reason: string,
  updatedBy: UserId
): WorkOrder {
  if (workOrder.sla.pausedAt) {
    throw new Error('SLA is already paused');
  }

  const now = new Date().toISOString();

  const timelineEntry: WorkOrderTimelineEntry = {
    timestamp: now,
    action: 'SLA paused',
    status: workOrder.status,
    userId: updatedBy,
    notes: reason,
  };

  return {
    ...workOrder,
    sla: {
      ...workOrder.sla,
      pausedAt: now,
      pauseReason: reason,
    },
    timeline: [...workOrder.timeline, timelineEntry],
    updatedAt: now,
    updatedBy,
  };
}

/** Resume SLA */
export function resumeSLA(
  workOrder: WorkOrder,
  updatedBy: UserId
): WorkOrder {
  if (!workOrder.sla.pausedAt) {
    throw new Error('SLA is not paused');
  }

  const now = new Date().toISOString();
  const pausedAt = new Date(workOrder.sla.pausedAt);
  const pauseDuration = Math.round((Date.now() - pausedAt.getTime()) / (60 * 1000));

  // Extend due dates by pause duration
  const responseDueAt = new Date(new Date(workOrder.sla.responseDueAt).getTime() + pauseDuration * 60 * 1000);
  const resolutionDueAt = new Date(new Date(workOrder.sla.resolutionDueAt).getTime() + pauseDuration * 60 * 1000);

  const timelineEntry: WorkOrderTimelineEntry = {
    timestamp: now,
    action: `SLA resumed (paused for ${pauseDuration} minutes)`,
    status: workOrder.status,
    userId: updatedBy,
    notes: null,
  };

  return {
    ...workOrder,
    sla: {
      ...workOrder.sla,
      pausedAt: null,
      pauseReason: null,
      pausedDurationMinutes: workOrder.sla.pausedDurationMinutes + pauseDuration,
      responseDueAt: responseDueAt.toISOString(),
      resolutionDueAt: resolutionDueAt.toISOString(),
    },
    timeline: [...workOrder.timeline, timelineEntry],
    updatedAt: now,
    updatedBy,
  };
}

/** Check if response SLA is breached */
export function isResponseSLABreached(workOrder: WorkOrder): boolean {
  if (workOrder.sla.respondedAt || workOrder.sla.pausedAt) return false;
  return new Date() > new Date(workOrder.sla.responseDueAt);
}

/** Check if resolution SLA is breached */
export function isResolutionSLABreached(workOrder: WorkOrder): boolean {
  if (workOrder.sla.resolvedAt || workOrder.sla.pausedAt) return false;
  return new Date() > new Date(workOrder.sla.resolutionDueAt);
}

/** Calculate time remaining for response */
export function getResponseTimeRemaining(workOrder: WorkOrder): number {
  if (workOrder.sla.respondedAt) return 0;
  const dueAt = new Date(workOrder.sla.responseDueAt).getTime();
  const now = Date.now();
  return Math.max(0, Math.round((dueAt - now) / (60 * 1000)));
}

/** Calculate time remaining for resolution */
export function getResolutionTimeRemaining(workOrder: WorkOrder): number {
  if (workOrder.sla.resolvedAt) return 0;
  const dueAt = new Date(workOrder.sla.resolutionDueAt).getTime();
  const now = Date.now();
  return Math.max(0, Math.round((dueAt - now) / (60 * 1000)));
}

/** Generate work order number */
export function generateWorkOrderNumber(year: number, sequence: number): string {
  return `WO-${year}-${String(sequence).padStart(4, '0')}`;
}
