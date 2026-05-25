/**
 * Feedback API Service
 * Feedback and complaints management
 */

import { getApiClient, ApiResponse } from '../client';
import type { PaginationInfo } from '../types';
import { buildQueryParams } from '../types';

export type FeedbackType = 'COMPLAINT' | 'SUGGESTION' | 'PRAISE' | 'GENERAL';

export type FeedbackStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';

export type FeedbackPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';

export interface Feedback {
  id: string;
  tenantId: string;
  customerId?: string;
  leaseId?: string;
  unitId?: string;
  workOrderId?: string;
  type: FeedbackType;
  status: FeedbackStatus;
  priority: FeedbackPriority;
  subject: string;
  description: string;
  rating?: number;
  attachments?: string[];
  resolution?: string;
  resolvedAt?: string;
  resolvedBy?: string;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}

export interface ListFeedbackParams {
  page?: number;
  pageSize?: number;
  type?: FeedbackType;
  status?: FeedbackStatus;
  priority?: FeedbackPriority;
  customerId?: string;
  dateFrom?: string;
  dateTo?: string;
}

export interface CreateFeedbackRequest {
  type: FeedbackType;
  subject: string;
  description: string;
  priority?: FeedbackPriority;
  leaseId?: string;
  unitId?: string;
  workOrderId?: string;
  rating?: number;
  attachments?: string[];
}

export interface UpdateFeedbackRequest {
  status?: FeedbackStatus;
  priority?: FeedbackPriority;
  resolution?: string;
}

export const feedbackService = {
  /**
   * List feedback with filters and pagination
   */
  async list(
    params?: ListFeedbackParams
  ): Promise<ApiResponse<Feedback[]> & { pagination?: PaginationInfo }> {
    const searchParams = buildQueryParams({
      page: params?.page,
      pageSize: params?.pageSize,
      type: params?.type,
      status: params?.status,
      priority: params?.priority,
      customerId: params?.customerId,
      dateFrom: params?.dateFrom,
      dateTo: params?.dateTo,
    });
    return getApiClient().get<Feedback[]>('/feedback', searchParams) as Promise<
      ApiResponse<Feedback[]> & { pagination?: PaginationInfo }
    >;
  },

  /**
   * Get feedback by ID
   */
  async get(id: string): Promise<ApiResponse<Feedback>> {
    return getApiClient().get<Feedback>(`/feedback/${id}`);
  },

  /**
   * Create feedback
   */
  async create(request: CreateFeedbackRequest): Promise<ApiResponse<Feedback>> {
    return getApiClient().post<Feedback>('/feedback', request);
  },

  /**
   * Update feedback
   */
  async update(id: string, request: UpdateFeedbackRequest): Promise<ApiResponse<Feedback>> {
    return getApiClient().patch<Feedback>(`/feedback/${id}`, request);
  },

  /**
   * Resolve feedback
   */
  async resolve(id: string, resolution: string): Promise<ApiResponse<Feedback>> {
    return getApiClient().post<Feedback>(`/feedback/${id}/resolve`, { resolution });
  },

  /**
   * Get my feedback (for customer app)
   */
  async getMyFeedback(
    params?: { page?: number; pageSize?: number; status?: FeedbackStatus }
  ): Promise<ApiResponse<Feedback[]> & { pagination?: PaginationInfo }> {
    const searchParams = buildQueryParams({
      page: params?.page,
      pageSize: params?.pageSize,
      status: params?.status,
    });
    return getApiClient().get<Feedback[]>('/feedback/my', searchParams) as Promise<
      ApiResponse<Feedback[]> & { pagination?: PaginationInfo }
    >;
  },
};
