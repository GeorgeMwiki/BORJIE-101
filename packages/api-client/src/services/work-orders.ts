/**
 * Work Orders API Service
 */

import { getApiClient, ApiResponse } from '../client';
import type {
  WorkOrder,
  WorkOrderId,
  WorkOrderStatus,
  WorkOrderPriority,
  WorkOrderCategory,
} from '@borjie/domain-models';

export interface WorkOrderFilters {
  status?: WorkOrderStatus[];
  priority?: WorkOrderPriority[];
  category?: WorkOrderCategory[];
  assignedToUserId?: string;
  unitId?: string;
  propertyId?: string;
  slaBreached?: boolean;
}

export interface CreateWorkOrderRequest {
  propertyId: string;
  unitId?: string;
  customerId?: string;
  priority: WorkOrderPriority;
  category: WorkOrderCategory;
  title: string;
  description: string;
  location: string;
  attachments?: Array<{ type: string; url: string; filename: string }>;
  requiresEntry?: boolean;
  entryInstructions?: string;
  permissionToEnter?: boolean;
}

export interface UpdateWorkOrderRequest {
  status?: WorkOrderStatus;
  priority?: WorkOrderPriority;
  assignedToUserId?: string;
  vendorId?: string;
  scheduledDate?: string;
  scheduledTimeSlot?: string;
  estimatedCost?: { amount: number; currency: string };
  completionNotes?: string;
  actualCost?: { amount: number; currency: string };
}

export interface WorkOrderRating {
  rating: number;
  feedback?: string;
}

export const workOrdersService = {
  /**
   * List work orders with optional filters
   */
  async list(filters?: WorkOrderFilters, page = 1, limit = 20): Promise<ApiResponse<WorkOrder[]>> {
    const params: Record<string, string> = {
      page: String(page),
      limit: String(limit),
    };

    if (filters?.status?.length) {
      params.status = filters.status.join(',');
    }
    if (filters?.priority?.length) {
      params.priority = filters.priority.join(',');
    }
    if (filters?.category?.length) {
      params.category = filters.category.join(',');
    }
    if (filters?.assignedToUserId) {
      params.assignedToUserId = filters.assignedToUserId;
    }
    if (filters?.unitId) {
      params.unitId = filters.unitId;
    }
    if (filters?.propertyId) {
      params.propertyId = filters.propertyId;
    }
    if (filters?.slaBreached !== undefined) {
      params.slaBreached = String(filters.slaBreached);
    }

    return getApiClient().get<WorkOrder[]>('/work-orders', params);
  },

  /**
   * Get a single work order by ID
   */
  async get(id: WorkOrderId): Promise<ApiResponse<WorkOrder>> {
    return getApiClient().get<WorkOrder>(`/work-orders/${id}`);
  },

  /**
   * Create a new work order
   */
  async create(request: CreateWorkOrderRequest): Promise<ApiResponse<WorkOrder>> {
    return getApiClient().post<WorkOrder>('/work-orders', request);
  },

  /**
   * Update a work order
   */
  async update(id: WorkOrderId, request: UpdateWorkOrderRequest): Promise<ApiResponse<WorkOrder>> {
    return getApiClient().patch<WorkOrder>(`/work-orders/${id}`, request);
  },

  /**
   * Triage a work order (manager action)
   */
  async triage(
    id: WorkOrderId,
    data: { priority?: WorkOrderPriority; category?: WorkOrderCategory; notes?: string }
  ): Promise<ApiResponse<WorkOrder>> {
    return getApiClient().post<WorkOrder>(`/work-orders/${id}/triage`, data);
  },

  /**
   * Assign a work order
   */
  async assign(
    id: WorkOrderId,
    data: { assignedToUserId?: string; vendorId?: string; notes?: string }
  ): Promise<ApiResponse<WorkOrder>> {
    return getApiClient().post<WorkOrder>(`/work-orders/${id}/assign`, data);
  },

  /**
   * Schedule a work order
   */
  async schedule(
    id: WorkOrderId,
    data: { scheduledDate: string; scheduledTimeSlot: string; notes?: string }
  ): Promise<ApiResponse<WorkOrder>> {
    return getApiClient().post<WorkOrder>(`/work-orders/${id}/schedule`, data);
  },

  /**
   * Start work on an order
   */
  async startWork(id: WorkOrderId, notes?: string): Promise<ApiResponse<WorkOrder>> {
    return getApiClient().post<WorkOrder>(`/work-orders/${id}/start`, { notes });
  },

  /**
   * Complete a work order
   */
  async complete(
    id: WorkOrderId,
    data: { completionNotes: string; actualCost?: { amount: number; currency: string } }
  ): Promise<ApiResponse<WorkOrder>> {
    return getApiClient().post<WorkOrder>(`/work-orders/${id}/complete`, data);
  },

  /**
   * Submit customer rating
   */
  async rate(id: WorkOrderId, rating: WorkOrderRating): Promise<ApiResponse<WorkOrder>> {
    return getApiClient().post<WorkOrder>(`/work-orders/${id}/rate`, rating);
  },

  /**
   * Pause SLA tracking
   */
  async pauseSLA(id: WorkOrderId, reason: string): Promise<ApiResponse<WorkOrder>> {
    return getApiClient().post<WorkOrder>(`/work-orders/${id}/sla/pause`, { reason });
  },

  /**
   * Resume SLA tracking
   */
  async resumeSLA(id: WorkOrderId): Promise<ApiResponse<WorkOrder>> {
    return getApiClient().post<WorkOrder>(`/work-orders/${id}/sla/resume`, {});
  },

  /**
   * Escalate a work order
   */
  async escalate(id: WorkOrderId, reason: string): Promise<ApiResponse<WorkOrder>> {
    return getApiClient().post<WorkOrder>(`/work-orders/${id}/escalate`, { reason });
  },

  /**
   * Cancel a work order
   */
  async cancel(id: WorkOrderId, reason: string): Promise<ApiResponse<WorkOrder>> {
    return getApiClient().post<WorkOrder>(`/work-orders/${id}/cancel`, { reason });
  },

  /**
   * Get work orders assigned to current user (for manager app)
   */
  async getMyTasks(status?: WorkOrderStatus[]): Promise<ApiResponse<WorkOrder[]>> {
    const params: Record<string, string> = {};
    if (status?.length) {
      params.status = status.join(',');
    }
    return getApiClient().get<WorkOrder[]>('/work-orders/my-tasks', params);
  },

  /**
   * Get work orders for a customer (for customer app)
   */
  async getMyRequests(status?: WorkOrderStatus[]): Promise<ApiResponse<WorkOrder[]>> {
    const params: Record<string, string> = {};
    if (status?.length) {
      params.status = status.join(',');
    }
    return getApiClient().get<WorkOrder[]>('/work-orders/my-requests', params);
  },
};
