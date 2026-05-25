/**
 * Leases API Service
 * Lease lifecycle
 */

import { getApiClient, ApiResponse } from '../client';
import type { PaginationInfo } from '../types';
import { buildQueryParams } from '../types';

export interface Lease {
  id: string;
  tenantId: string;
  unitId: string;
  customerId: string;
  status: string;
  startDate: string;
  endDate: string;
  rentAmount: number;
  depositAmount: number;
  depositPaid: number;
  paymentDueDay: number;
  terms?: Record<string, unknown>;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}

export interface LeaseWithDetails extends Lease {
  unit?: { id: string; unitNumber: string };
  customer?: { id: string; name: string };
  property?: { id: string; name: string };
}

export interface ListLeasesParams {
  page?: number;
  pageSize?: number;
  status?: string;
  propertyId?: string;
  customerId?: string;
}

export interface CreateLeaseRequest {
  unitId: string;
  customerId: string;
  startDate: string;
  endDate: string;
  rentAmount: number;
  depositAmount: number;
  paymentDueDay?: number;
  terms?: Record<string, unknown>;
}

export const leasesService = {
  async list(
    params?: ListLeasesParams
  ): Promise<ApiResponse<LeaseWithDetails[]> & { pagination?: PaginationInfo }> {
    const searchParams = buildQueryParams({
      page: params?.page,
      pageSize: params?.pageSize,
      status: params?.status,
      propertyId: params?.propertyId,
      customerId: params?.customerId,
    });

    return getApiClient().get<LeaseWithDetails[]>('/leases', searchParams) as Promise<
      ApiResponse<LeaseWithDetails[]> & { pagination?: PaginationInfo }
    >;
  },

  async get(id: string): Promise<ApiResponse<LeaseWithDetails>> {
    return getApiClient().get<LeaseWithDetails>(`/leases/${id}`);
  },

  async getExpiring(
    days = 60,
    page = 1,
    pageSize = 20
  ): Promise<ApiResponse<LeaseWithDetails[]> & { pagination?: PaginationInfo }> {
    return getApiClient().get<LeaseWithDetails[]>('/leases/expiring', {
      params: {
        days: String(days),
        page: String(page),
        pageSize: String(pageSize),
      },
    }) as Promise<ApiResponse<LeaseWithDetails[]> & { pagination?: PaginationInfo }>;
  },

  async create(request: CreateLeaseRequest): Promise<ApiResponse<Lease>> {
    return getApiClient().post<Lease>('/leases', request);
  },

  async update(id: string, request: Partial<CreateLeaseRequest>): Promise<ApiResponse<Lease>> {
    return getApiClient().put<Lease>(`/leases/${id}`, request);
  },

  async activate(id: string): Promise<ApiResponse<Lease>> {
    return getApiClient().post<Lease>(`/leases/${id}/activate`, {});
  },

  async terminate(id: string, reason?: string): Promise<ApiResponse<Lease>> {
    return getApiClient().post<Lease>(`/leases/${id}/terminate`, { reason });
  },

  async renew(
    id: string,
    params?: { newEndDate?: string; extendMonths?: number; newRentAmount?: number }
  ): Promise<ApiResponse<Lease>> {
    return getApiClient().post<Lease>(`/leases/${id}/renew`, params ?? {});
  },
};
