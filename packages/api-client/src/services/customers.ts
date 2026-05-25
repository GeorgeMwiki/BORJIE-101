/**
 * Customers API Service
 * Customer management
 */

import { getApiClient, ApiResponse } from '../client';
import type { PaginationInfo } from '../types';
import { buildQueryParams } from '../types';

export interface Customer {
  id: string;
  tenantId: string;
  type: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  idNumber?: string;
  idType?: string;
  companyName?: string;
  companyRegNumber?: string;
  preferences: Record<string, unknown>;
  verificationStatus: string;
  deletedAt?: string;
  blacklisted?: boolean;
  blacklistReason?: string;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}

export interface CustomerWithLease extends Customer {
  currentLease?: {
    id: string;
    unitNumber?: string;
    propertyId?: string;
  } | null;
  leases?: Array<{
    id: string;
    status: string;
    startDate: string;
    endDate: string;
    rentAmount: number;
    unitId: string;
  }>;
  currentUnit?: {
    id: string;
    unitNumber: string;
    propertyId: string;
  } | null;
}

export interface ListCustomersParams {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: string;
}

export interface CreateCustomerRequest {
  type: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  idNumber?: string;
  idType?: string;
  companyName?: string;
  companyRegNumber?: string;
  preferences?: Record<string, unknown>;
}

export const customersService = {
  async list(
    params?: ListCustomersParams
  ): Promise<ApiResponse<CustomerWithLease[]> & { pagination?: PaginationInfo }> {
    const searchParams = buildQueryParams({
      page: params?.page,
      pageSize: params?.pageSize,
      search: params?.search,
      status: params?.status,
    });

    return getApiClient().get<CustomerWithLease[]>('/customers', searchParams) as Promise<
      ApiResponse<CustomerWithLease[]> & { pagination?: PaginationInfo }
    >;
  },

  async get(id: string): Promise<ApiResponse<CustomerWithLease>> {
    return getApiClient().get<CustomerWithLease>(`/customers/${id}`);
  },

  async create(request: CreateCustomerRequest): Promise<ApiResponse<Customer>> {
    return getApiClient().post<Customer>('/customers', request);
  },

  async update(id: string, request: Partial<CreateCustomerRequest>): Promise<ApiResponse<Customer>> {
    return getApiClient().put<Customer>(`/customers/${id}`, request);
  },

  async delete(id: string): Promise<ApiResponse<{ message: string }>> {
    return getApiClient().delete<{ message: string }>(`/customers/${id}`);
  },

  async getLeases(
    id: string,
    page = 1,
    pageSize = 20
  ): Promise<ApiResponse<unknown[]> & { pagination?: PaginationInfo }> {
    return getApiClient().get<unknown[]>(`/customers/${id}/leases`, {
      params: {
        page: String(page),
        pageSize: String(pageSize),
      },
    }) as Promise<ApiResponse<unknown[]> & { pagination?: PaginationInfo }>;
  },
};
