/**
 * Vendors API Service
 * Vendor management for maintenance
 */

import { getApiClient, ApiResponse } from '../client';
import type { PaginationInfo } from '../types';
import { buildQueryParams } from '../types';

export type VendorCategory =
  | 'PLUMBING'
  | 'ELECTRICAL'
  | 'HVAC'
  | 'GENERAL'
  | 'APPLIANCE'
  | 'STRUCTURAL';

export interface Vendor {
  id: string;
  tenantId: string;
  name: string;
  companyName?: string;
  email: string;
  phone: string;
  categories: VendorCategory[];
  isAvailable: boolean;
  rating?: number;
  completedJobs?: number;
  responseTimeHours?: number;
  deletedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ListVendorsParams {
  page?: number;
  pageSize?: number;
  category?: VendorCategory;
  available?: boolean;
  search?: string;
}

export interface CreateVendorRequest {
  name: string;
  companyName?: string;
  email: string;
  phone: string;
  categories: VendorCategory[];
  isAvailable?: boolean;
}

export interface UpdateVendorRequest {
  name?: string;
  companyName?: string;
  email?: string;
  phone?: string;
  categories?: VendorCategory[];
  isAvailable?: boolean;
}

export const vendorsService = {
  /**
   * List vendors with filters and pagination
   */
  async list(
    params?: ListVendorsParams
  ): Promise<ApiResponse<Vendor[]> & { pagination?: PaginationInfo }> {
    const searchParams = buildQueryParams({
      page: params?.page,
      pageSize: params?.pageSize,
      category: params?.category,
      available: params?.available,
      search: params?.search,
    });
    return getApiClient().get<Vendor[]>('/vendors', { params: searchParams }) as Promise<
      ApiResponse<Vendor[]> & { pagination?: PaginationInfo }
    >;
  },

  /**
   * Get available vendors for a category
   */
  async getAvailable(category: VendorCategory): Promise<ApiResponse<Vendor[]>> {
    return getApiClient().get<Vendor[]>('/vendors/available', { params: { category } });
  },

  /**
   * Get vendor by ID
   */
  async get(id: string): Promise<ApiResponse<Vendor>> {
    return getApiClient().get<Vendor>(`/vendors/${id}`);
  },

  /**
   * Create vendor
   */
  async create(request: CreateVendorRequest): Promise<ApiResponse<Vendor>> {
    return getApiClient().post<Vendor>('/vendors', request);
  },

  /**
   * Update vendor
   */
  async update(id: string, request: UpdateVendorRequest): Promise<ApiResponse<Vendor>> {
    return getApiClient().put<Vendor>(`/vendors/${id}`, request);
  },

  /**
   * Delete vendor (soft delete)
   */
  async delete(id: string): Promise<ApiResponse<{ id: string; message: string }>> {
    return getApiClient().delete<{ id: string; message: string }>(`/vendors/${id}`);
  },
};
