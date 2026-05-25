/**
 * Properties API Service
 * Properties and units
 */

import { getApiClient, ApiResponse } from '../client';
import type { PaginationInfo } from '../types';
import { buildQueryParams } from '../types';

export interface Property {
  id: string;
  tenantId: string;
  name: string;
  type: string;
  status: string;
  address: {
    line1: string;
    city: string;
    region?: string;
    country: string;
    coordinates?: { latitude: number; longitude: number };
  };
  description?: string;
  amenities: string[];
  images: string[];
  managerId?: string;
  totalUnits: number;
  occupiedUnits: number;
  settings?: Record<string, unknown>;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}

export interface PropertyWithStats extends Property {
  stats?: {
    totalUnits: number;
    occupiedUnits: number;
    availableUnits: number;
    occupancyRate: number;
  };
}

export interface ListPropertiesParams {
  page?: number;
  pageSize?: number;
  status?: string;
  type?: string;
  city?: string;
  search?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface CreatePropertyRequest {
  name: string;
  type: string;
  status?: string;
  address: {
    line1: string;
    city: string;
    region?: string;
    country: string;
    coordinates?: { latitude: number; longitude: number };
  };
  description?: string;
  amenities?: string[];
  images?: string[];
  managerId?: string;
  totalUnits?: number;
  occupiedUnits?: number;
}

export const propertiesService = {
  async list(
    params?: ListPropertiesParams
  ): Promise<ApiResponse<Property[]> & { pagination?: PaginationInfo }> {
    const searchParams = buildQueryParams({
      page: params?.page,
      pageSize: params?.pageSize,
      status: params?.status,
      type: params?.type,
      city: params?.city,
      search: params?.search,
      sortBy: params?.sortBy,
      sortOrder: params?.sortOrder,
    });

    return getApiClient().get<Property[]>('/properties', searchParams) as Promise<
      ApiResponse<Property[]> & { pagination?: PaginationInfo }
    >;
  },

  async get(id: string): Promise<ApiResponse<PropertyWithStats>> {
    return getApiClient().get<PropertyWithStats>(`/properties/${id}`);
  },

  async create(request: CreatePropertyRequest): Promise<ApiResponse<Property>> {
    return getApiClient().post<Property>('/properties', request);
  },

  async update(id: string, request: Partial<CreatePropertyRequest>): Promise<ApiResponse<Property>> {
    return getApiClient().put<Property>(`/properties/${id}`, request);
  },

  async delete(id: string): Promise<ApiResponse<{ message: string }>> {
    return getApiClient().delete<{ message: string }>(`/properties/${id}`);
  },

  async getUnits(
    propertyId: string,
    page = 1,
    pageSize = 20,
    status?: string
  ): Promise<ApiResponse<unknown[]> & { pagination?: PaginationInfo }> {
    const params = buildQueryParams({ page, pageSize, status });
    return getApiClient().get<unknown[]>(`/properties/${propertyId}/units`, params) as Promise<
      ApiResponse<unknown[]> & { pagination?: PaginationInfo }
    >;
  },
};
