/**
 * Units API Service
 */

import { getApiClient, ApiResponse } from '../client';
import type { PaginationInfo } from '../types';
import { buildQueryParams } from '../types';

export interface Unit {
  id: string;
  tenantId: string;
  propertyId: string;
  unitNumber: string;
  floor?: number;
  type: string;
  status: string;
  bedrooms: number;
  bathrooms: number;
  squareMeters?: number;
  rentAmount: number;
  depositAmount: number;
  amenities: string[];
  images: string[];
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}

export interface UnitWithTenant extends Unit {
  currentLease?: {
    id: string;
    startDate: string;
    endDate: string;
    rentAmount: number;
  } | null;
  currentTenant?: {
    id: string;
    name: string;
    email: string;
    phone: string;
  } | null;
}

export interface ListUnitsParams {
  page?: number;
  pageSize?: number;
  status?: string;
  type?: string;
  propertyId?: string;
  search?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface CreateUnitRequest {
  propertyId: string;
  unitNumber: string;
  floor?: number;
  type: string;
  status?: string;
  bedrooms: number;
  bathrooms: number;
  squareMeters?: number;
  rentAmount: number;
  depositAmount: number;
  amenities?: string[];
  images?: string[];
}

export const unitsService = {
  async list(
    params?: ListUnitsParams
  ): Promise<ApiResponse<Unit[]> & { pagination?: PaginationInfo }> {
    const searchParams = buildQueryParams({
      page: params?.page,
      pageSize: params?.pageSize,
      status: params?.status,
      type: params?.type,
      propertyId: params?.propertyId,
      search: params?.search,
      sortBy: params?.sortBy,
      sortOrder: params?.sortOrder,
    });

    return getApiClient().get<Unit[]>('/units', searchParams) as Promise<
      ApiResponse<Unit[]> & { pagination?: PaginationInfo }
    >;
  },

  async get(id: string): Promise<ApiResponse<UnitWithTenant>> {
    return getApiClient().get<UnitWithTenant>(`/units/${id}`);
  },

  async create(request: CreateUnitRequest): Promise<ApiResponse<Unit>> {
    return getApiClient().post<Unit>('/units', request);
  },

  async update(id: string, request: Partial<CreateUnitRequest>): Promise<ApiResponse<Unit>> {
    return getApiClient().put<Unit>(`/units/${id}`, request);
  },

  async delete(id: string): Promise<ApiResponse<{ message: string }>> {
    return getApiClient().delete<{ message: string }>(`/units/${id}`);
  },

  async updateStatus(id: string, status: string): Promise<ApiResponse<Unit>> {
    return getApiClient().put<Unit>(`/units/${id}/status`, { status });
  },
};
