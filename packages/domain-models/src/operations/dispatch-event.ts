/**
 * Dispatch Event domain model
 * Tracks vendor/technician dispatch events for work orders
 */

import { z } from 'zod';
import type {
  TenantId,
  UserId,
  WorkOrderId,
  VendorId,
  DispatchEventId,
  PropertyId,
  UnitId,
  EntityMetadata,
  ISOTimestamp,
} from '../common/types';

// ============================================================================
// Enums and Schemas
// ============================================================================

export const DispatchStatusSchema = z.enum([
  'scheduled',
  'dispatched',
  'en_route',
  'arrived',
  'in_progress',
  'completed',
  'cancelled',
  'no_show',
  'rescheduled',
]);
export type DispatchStatus = z.infer<typeof DispatchStatusSchema>;

export const DispatchTypeSchema = z.enum([
  'initial_visit',
  'follow_up',
  'parts_delivery',
  'inspection',
  'emergency',
]);
export type DispatchType = z.infer<typeof DispatchTypeSchema>;

export const LocationUpdateSchema = z.object({
  latitude: z.number(),
  longitude: z.number(),
  accuracy: z.number().optional(),
  timestamp: z.string().datetime(),
  source: z.enum(['gps', 'network', 'manual']),
});
export type LocationUpdate = z.infer<typeof LocationUpdateSchema>;

export const DispatchEventSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  workOrderId: z.string(),
  vendorId: z.string(),
  propertyId: z.string(),
  unitId: z.string().optional(),
  
  // Type and status
  dispatchType: DispatchTypeSchema,
  status: DispatchStatusSchema,
  
  // Assignment
  technicianId: z.string().optional(),
  technicianName: z.string(),
  technicianPhone: z.string().optional(),
  
  // Scheduling
  scheduledDate: z.string().datetime(),
  scheduledTimeStart: z.string(),
  scheduledTimeEnd: z.string(),
  estimatedDuration: z.number().optional(), // in minutes
  
  // Dispatch
  dispatchedAt: z.string().datetime().optional(),
  dispatchedBy: z.string().optional(),
  dispatchNotes: z.string().optional(),
  
  // En route
  enRouteAt: z.string().datetime().optional(),
  estimatedArrival: z.string().datetime().optional(),
  
  // Arrival
  arrivedAt: z.string().datetime().optional(),
  arrivalLatitude: z.number().optional(),
  arrivalLongitude: z.number().optional(),
  arrivalVerified: z.boolean().default(false),
  
  // In progress
  startedAt: z.string().datetime().optional(),
  
  // Completion
  completedAt: z.string().datetime().optional(),
  actualDuration: z.number().optional(), // in minutes
  completionLatitude: z.number().optional(),
  completionLongitude: z.number().optional(),
  
  // Location history
  locationUpdates: z.array(LocationUpdateSchema).default([]),
  
  // Cancellation
  cancelledAt: z.string().datetime().optional(),
  cancelledBy: z.string().optional(),
  cancellationReason: z.string().optional(),
  
  // Rescheduling
  rescheduledAt: z.string().datetime().optional(),
  rescheduledBy: z.string().optional(),
  rescheduleReason: z.string().optional(),
  originalScheduledDate: z.string().datetime().optional(),
  
  // No show
  markedNoShowAt: z.string().datetime().optional(),
  noShowReason: z.string().optional(),
  
  // Notes
  notes: z.string().optional(),
  
  // Metadata
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export type DispatchEventData = z.infer<typeof DispatchEventSchema>;

// ============================================================================
// Dispatch Event Interface
// ============================================================================

export interface DispatchEvent extends EntityMetadata {
  readonly id: DispatchEventId;
  readonly tenantId: TenantId;
  readonly workOrderId: WorkOrderId;
  readonly vendorId: VendorId;
  readonly propertyId: PropertyId;
  readonly unitId: UnitId | null;
  
  readonly dispatchType: DispatchType;
  readonly status: DispatchStatus;
  
  readonly technicianId: UserId | null;
  readonly technicianName: string;
  readonly technicianPhone: string | null;
  
  readonly scheduledDate: ISOTimestamp;
  readonly scheduledTimeStart: string;
  readonly scheduledTimeEnd: string;
  readonly estimatedDuration: number | null;
  
  readonly dispatchedAt: ISOTimestamp | null;
  readonly dispatchedBy: UserId | null;
  readonly dispatchNotes: string | null;
  
  readonly enRouteAt: ISOTimestamp | null;
  readonly estimatedArrival: ISOTimestamp | null;
  
  readonly arrivedAt: ISOTimestamp | null;
  readonly arrivalLatitude: number | null;
  readonly arrivalLongitude: number | null;
  readonly arrivalVerified: boolean;
  
  readonly startedAt: ISOTimestamp | null;
  
  readonly completedAt: ISOTimestamp | null;
  readonly actualDuration: number | null;
  readonly completionLatitude: number | null;
  readonly completionLongitude: number | null;
  
  readonly locationUpdates: readonly LocationUpdate[];
  
  readonly cancelledAt: ISOTimestamp | null;
  readonly cancelledBy: UserId | null;
  readonly cancellationReason: string | null;
  
  readonly rescheduledAt: ISOTimestamp | null;
  readonly rescheduledBy: UserId | null;
  readonly rescheduleReason: string | null;
  readonly originalScheduledDate: ISOTimestamp | null;
  
  readonly markedNoShowAt: ISOTimestamp | null;
  readonly noShowReason: string | null;
  
  readonly notes: string | null;
  
  readonly metadata: Record<string, unknown>;
}

// ============================================================================
// Factory Functions
// ============================================================================

export function createDispatchEvent(
  id: DispatchEventId,
  data: {
    tenantId: TenantId;
    workOrderId: WorkOrderId;
    vendorId: VendorId;
    propertyId: PropertyId;
    dispatchType: DispatchType;
    technicianName: string;
    scheduledDate: Date;
    scheduledTimeStart: string;
    scheduledTimeEnd: string;
    unitId?: UnitId;
    technicianId?: UserId;
    technicianPhone?: string;
    estimatedDuration?: number;
    notes?: string;
  },
  createdBy: UserId
): DispatchEvent {
  const now = new Date().toISOString();

  return {
    id,
    tenantId: data.tenantId,
    workOrderId: data.workOrderId,
    vendorId: data.vendorId,
    propertyId: data.propertyId,
    unitId: data.unitId ?? null,
    
    dispatchType: data.dispatchType,
    status: 'scheduled',
    
    technicianId: data.technicianId ?? null,
    technicianName: data.technicianName,
    technicianPhone: data.technicianPhone ?? null,
    
    scheduledDate: data.scheduledDate.toISOString(),
    scheduledTimeStart: data.scheduledTimeStart,
    scheduledTimeEnd: data.scheduledTimeEnd,
    estimatedDuration: data.estimatedDuration ?? null,
    
    dispatchedAt: null,
    dispatchedBy: null,
    dispatchNotes: null,
    
    enRouteAt: null,
    estimatedArrival: null,
    
    arrivedAt: null,
    arrivalLatitude: null,
    arrivalLongitude: null,
    arrivalVerified: false,
    
    startedAt: null,
    
    completedAt: null,
    actualDuration: null,
    completionLatitude: null,
    completionLongitude: null,
    
    locationUpdates: [],
    
    cancelledAt: null,
    cancelledBy: null,
    cancellationReason: null,
    
    rescheduledAt: null,
    rescheduledBy: null,
    rescheduleReason: null,
    originalScheduledDate: null,
    
    markedNoShowAt: null,
    noShowReason: null,
    
    notes: data.notes ?? null,
    
    metadata: {},
    
    createdAt: now,
    updatedAt: now,
    createdBy,
    updatedBy: createdBy,
  };
}

// ============================================================================
// Business Logic Functions
// ============================================================================

export function dispatchTechnician(
  event: DispatchEvent,
  notes: string | undefined,
  dispatchedBy: UserId
): DispatchEvent {
  if (event.status !== 'scheduled') {
    throw new Error('Can only dispatch scheduled events');
  }
  const now = new Date().toISOString();
  return {
    ...event,
    status: 'dispatched',
    dispatchedAt: now,
    dispatchedBy,
    dispatchNotes: notes ?? null,
    updatedAt: now,
    updatedBy: dispatchedBy,
  };
}

export function markEnRoute(
  event: DispatchEvent,
  estimatedArrival: Date | undefined,
  updatedBy: UserId
): DispatchEvent {
  if (event.status !== 'dispatched') {
    throw new Error('Can only mark dispatched events as en route');
  }
  const now = new Date().toISOString();
  return {
    ...event,
    status: 'en_route',
    enRouteAt: now,
    estimatedArrival: estimatedArrival?.toISOString() ?? null,
    updatedAt: now,
    updatedBy,
  };
}

export function recordArrival(
  event: DispatchEvent,
  location: { latitude: number; longitude: number } | undefined,
  updatedBy: UserId
): DispatchEvent {
  if (event.status !== 'dispatched' && event.status !== 'en_route') {
    throw new Error('Can only record arrival for dispatched or en route events');
  }
  const now = new Date().toISOString();
  return {
    ...event,
    status: 'arrived',
    arrivedAt: now,
    arrivalLatitude: location?.latitude ?? null,
    arrivalLongitude: location?.longitude ?? null,
    arrivalVerified: !!location,
    updatedAt: now,
    updatedBy,
  };
}

export function startWork(
  event: DispatchEvent,
  updatedBy: UserId
): DispatchEvent {
  if (event.status !== 'arrived') {
    throw new Error('Can only start work after arrival');
  }
  const now = new Date().toISOString();
  return {
    ...event,
    status: 'in_progress',
    startedAt: now,
    updatedAt: now,
    updatedBy,
  };
}

export function completeDispatch(
  event: DispatchEvent,
  location: { latitude: number; longitude: number } | undefined,
  updatedBy: UserId
): DispatchEvent {
  if (event.status !== 'in_progress' && event.status !== 'arrived') {
    throw new Error('Can only complete in-progress or arrived events');
  }
  const now = new Date().toISOString();
  const startTime = event.startedAt ? new Date(event.startedAt).getTime() : new Date(event.arrivedAt!).getTime();
  const actualDuration = Math.round((Date.now() - startTime) / 60000);
  
  return {
    ...event,
    status: 'completed',
    completedAt: now,
    actualDuration,
    completionLatitude: location?.latitude ?? null,
    completionLongitude: location?.longitude ?? null,
    updatedAt: now,
    updatedBy,
  };
}

export function addLocationUpdate(
  event: DispatchEvent,
  location: LocationUpdate,
  updatedBy: UserId
): DispatchEvent {
  return {
    ...event,
    locationUpdates: [...event.locationUpdates, location],
    updatedAt: new Date().toISOString(),
    updatedBy,
  };
}

export function cancelDispatch(
  event: DispatchEvent,
  reason: string,
  updatedBy: UserId
): DispatchEvent {
  if (event.status === 'completed' || event.status === 'cancelled') {
    throw new Error('Cannot cancel completed or already cancelled events');
  }
  const now = new Date().toISOString();
  return {
    ...event,
    status: 'cancelled',
    cancelledAt: now,
    cancelledBy: updatedBy,
    cancellationReason: reason,
    updatedAt: now,
    updatedBy,
  };
}

export function rescheduleDispatch(
  event: DispatchEvent,
  newDate: Date,
  newTimeStart: string,
  newTimeEnd: string,
  reason: string,
  updatedBy: UserId
): DispatchEvent {
  if (event.status === 'completed' || event.status === 'cancelled') {
    throw new Error('Cannot reschedule completed or cancelled events');
  }
  const now = new Date().toISOString();
  return {
    ...event,
    status: 'rescheduled',
    originalScheduledDate: event.originalScheduledDate ?? event.scheduledDate,
    scheduledDate: newDate.toISOString(),
    scheduledTimeStart: newTimeStart,
    scheduledTimeEnd: newTimeEnd,
    rescheduledAt: now,
    rescheduledBy: updatedBy,
    rescheduleReason: reason,
    updatedAt: now,
    updatedBy,
  };
}

export function markNoShow(
  event: DispatchEvent,
  reason: string,
  updatedBy: UserId
): DispatchEvent {
  if (event.status !== 'dispatched' && event.status !== 'en_route' && event.status !== 'scheduled') {
    throw new Error('Can only mark scheduled, dispatched, or en-route events as no-show');
  }
  const now = new Date().toISOString();
  return {
    ...event,
    status: 'no_show',
    markedNoShowAt: now,
    noShowReason: reason,
    updatedAt: now,
    updatedBy,
  };
}
