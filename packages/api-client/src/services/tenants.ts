/**
 * Tenants API Service
 * Tenant CRUD and configuration
 */

import { getApiClient, ApiResponse } from '../client';
import { buildQueryParams } from '../types';

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  status: string;
  contactEmail: string;
  contactPhone?: string;
  settings: Record<string, unknown>;
  subscription: Record<string, unknown>;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}

export interface TenantSettings {
  timezone?: string;
  currency?: string;
  locale?: string;
  features?: string[];
  policies?: Record<string, unknown>;
}

export interface TenantSubscription {
  plan: string;
  status: string;
  maxUnits?: number;
  maxUsers?: number;
  currentPeriodEndsAt?: string;
}

export interface UpdateTenantRequest {
  name?: string;
  contactEmail?: string;
  contactPhone?: string;
}

export const tenantsService = {
  /**
   * Get current tenant
   */
  async getCurrent(): Promise<ApiResponse<Tenant>> {
    return getApiClient().get<Tenant>('/tenants/current');
  },

  /**
   * Update current tenant
   */
  async updateCurrent(request: UpdateTenantRequest): Promise<ApiResponse<Tenant>> {
    return getApiClient().patch<Tenant>('/tenants/current', request);
  },

  /**
   * Get tenant settings
   */
  async getSettings(): Promise<ApiResponse<TenantSettings>> {
    return getApiClient().get<TenantSettings>('/tenants/current/settings');
  },

  /**
   * Update tenant settings
   */
  async updateSettings(settings: Partial<TenantSettings>): Promise<ApiResponse<TenantSettings>> {
    return getApiClient().patch<TenantSettings>('/tenants/current/settings', settings);
  },

  /**
   * Get subscription info
   */
  async getSubscription(): Promise<ApiResponse<TenantSubscription>> {
    return getApiClient().get<TenantSubscription>('/tenants/current/subscription');
  },
};
