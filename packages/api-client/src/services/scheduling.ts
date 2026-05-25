/**
 * Scheduling API Service
 * Calendar and scheduling
 */

import { getApiClient, ApiResponse } from '../client';
import type { PaginationInfo } from '../types';
import { buildQueryParams } from '../types';

export type ScheduleEventType =
  | 'INSPECTION'
  | 'MAINTENANCE'
  | 'VIEWING'
  | 'LEASE_SIGNING'
  | 'MEETING'
  | 'OTHER';

export type ScheduleEventStatus = 'SCHEDULED' | 'CONFIRMED' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';

export interface ScheduleEvent {
  id: string;
  tenantId: string;
  type: ScheduleEventType;
  status: ScheduleEventStatus;
  title: string;
  description?: string;
  propertyId?: string;
  unitId?: string;
  customerId?: string;
  inspectionId?: string;
  workOrderId?: string;
  startAt: string;
  endAt: string;
  timeSlot?: string;
  location?: string;
  attendees?: string[];
  reminderMinutes?: number;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}

export interface ListScheduleParams {
  page?: number;
  pageSize?: number;
  type?: ScheduleEventType;
  status?: ScheduleEventStatus;
  propertyId?: string;
  unitId?: string;
  customerId?: string;
  startDate?: string;
  endDate?: string;
}

export interface CreateScheduleRequest {
  type: ScheduleEventType;
  title: string;
  description?: string;
  propertyId?: string;
  unitId?: string;
  customerId?: string;
  inspectionId?: string;
  workOrderId?: string;
  startAt: string;
  endAt: string;
  timeSlot?: string;
  location?: string;
  attendees?: string[];
  reminderMinutes?: number;
}

export interface UpdateScheduleRequest {
  type?: ScheduleEventType;
  status?: ScheduleEventStatus;
  title?: string;
  description?: string;
  startAt?: string;
  endAt?: string;
  timeSlot?: string;
  location?: string;
  attendees?: string[];
  reminderMinutes?: number;
}

export interface TimeSlot {
  slot: string;
  available: boolean;
}

export const schedulingService = {
  /**
   * List schedule events with filters
   */
  async list(
    params?: ListScheduleParams
  ): Promise<ApiResponse<ScheduleEvent[]> & { pagination?: PaginationInfo }> {
    const searchParams = buildQueryParams({
      page: params?.page,
      pageSize: params?.pageSize,
      type: params?.type,
      status: params?.status,
      propertyId: params?.propertyId,
      unitId: params?.unitId,
      customerId: params?.customerId,
      startDate: params?.startDate,
      endDate: params?.endDate,
    });
    return getApiClient().get<ScheduleEvent[]>('/scheduling/events', searchParams) as Promise<
      ApiResponse<ScheduleEvent[]> & { pagination?: PaginationInfo }
    >;
  },

  /**
   * Get event by ID
   */
  async get(id: string): Promise<ApiResponse<ScheduleEvent>> {
    return getApiClient().get<ScheduleEvent>(`/scheduling/events/${id}`);
  },

  /**
   * Create schedule event
   */
  async create(request: CreateScheduleRequest): Promise<ApiResponse<ScheduleEvent>> {
    return getApiClient().post<ScheduleEvent>('/scheduling/events', request);
  },

  /**
   * Update schedule event
   */
  async update(id: string, request: UpdateScheduleRequest): Promise<ApiResponse<ScheduleEvent>> {
    return getApiClient().patch<ScheduleEvent>(`/scheduling/events/${id}`, request);
  },

  /**
   * Cancel schedule event
   */
  async cancel(id: string): Promise<ApiResponse<ScheduleEvent>> {
    return getApiClient().post<ScheduleEvent>(`/scheduling/events/${id}/cancel`, {});
  },

  /**
   * Get available time slots for a date
   */
  async getAvailableSlots(
    date: string,
    params?: { duration?: number; propertyId?: string; unitId?: string }
  ): Promise<ApiResponse<TimeSlot[]>> {
    const searchParams = buildQueryParams({
      date,
      duration: params?.duration,
      propertyId: params?.propertyId,
      unitId: params?.unitId,
    });
    return getApiClient().get<TimeSlot[]>('/scheduling/available-slots', { params: searchParams });
  },

  /**
   * Get calendar view (events for date range)
   */
  async getCalendar(startDate: string, endDate: string): Promise<ApiResponse<ScheduleEvent[]>> {
    return getApiClient().get<ScheduleEvent[]>('/scheduling/calendar', {
      params: {
        startDate,
        endDate,
      },
    });
  },
};
