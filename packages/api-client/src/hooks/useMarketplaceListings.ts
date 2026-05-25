/**
 * Marketplace Listings hooks.
 *
 * Endpoints:
 *   GET  /marketplace/listings           → search / list
 *   GET  /marketplace/listings/:id       → detail
 *   POST /marketplace/listings           → publish
 *   PUT  /marketplace/listings/:id/status→ update status
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { ApiClientError } from '../client';
import { queryKeys } from './query-keys';
import {
  client,
  compact,
  defaultMutationRetry,
  defaultQueryRetry,
  type DefaultMutationOptions,
  type DefaultQueryOptions,
  type TenantScopeArg,
} from './shared';

export type ListingStatus = 'draft' | 'published' | 'paused' | 'closed';
export type ListingKind = 'rent' | 'lease' | 'sale';

export interface MarketplaceListing {
  readonly id: string;
  readonly tenantId: string;
  readonly unitId: string;
  readonly propertyId?: string;
  readonly listingKind: ListingKind;
  readonly headlinePrice: number;
  readonly currency: string;
  readonly negotiable: boolean;
  readonly status: ListingStatus;
  readonly expiresAt?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface MarketplaceListingsSearch {
  readonly status?: ListingStatus;
  readonly listingKind?: ListingKind;
  readonly minPrice?: number;
  readonly maxPrice?: number;
  readonly propertyId?: string;
  readonly limit?: number;
  readonly offset?: number;
}

export interface PublishListingInput {
  readonly unitId: string;
  readonly propertyId?: string;
  readonly listingKind: ListingKind;
  readonly headlinePrice: number;
  readonly currency?: string;
  readonly negotiable?: boolean;
  readonly media?: ReadonlyArray<Record<string, unknown>>;
  readonly attributes?: Record<string, unknown>;
  readonly negotiationPolicyId?: string;
  readonly expiresAt?: string;
  readonly publishImmediately?: boolean;
}

export interface UpdateListingStatusInput {
  readonly id: string;
  readonly status: ListingStatus;
}

const BASE = '/marketplace/listings';

export function useMarketplaceListings(
  scope: TenantScopeArg,
  filters?: MarketplaceListingsSearch,
  options?: DefaultQueryOptions<ReadonlyArray<MarketplaceListing>>,
) {
  return useQuery<ReadonlyArray<MarketplaceListing>, ApiClientError>({
    queryKey: queryKeys.marketplaceListings.list(
      scope,
      filters as Record<string, unknown> | undefined,
    ),
    queryFn: async () => {
      const res = await client().get<ReadonlyArray<MarketplaceListing>>(BASE, {
        params: compact(filters as Record<string, unknown>) as Record<string, string | number | boolean>,
      });
      return res.data;
    },
    ...defaultQueryRetry,
    ...options,
  });
}

export function useMarketplaceListing(
  scope: TenantScopeArg,
  id: string,
  options?: DefaultQueryOptions<MarketplaceListing>,
) {
  return useQuery<MarketplaceListing, ApiClientError>({
    queryKey: queryKeys.marketplaceListings.detail(scope, id),
    queryFn: async () => {
      const res = await client().get<MarketplaceListing>(`${BASE}/${id}`);
      return res.data;
    },
    enabled: Boolean(id),
    ...defaultQueryRetry,
    ...options,
  });
}

export function usePublishListing(
  scope: TenantScopeArg,
  options?: DefaultMutationOptions<MarketplaceListing, PublishListingInput>,
) {
  const qc = useQueryClient();
  return useMutation<MarketplaceListing, ApiClientError, PublishListingInput>({
    mutationFn: async (input) => {
      const res = await client().post<MarketplaceListing>(BASE, input);
      return res.data;
    },
    onSuccess: (data, variables, context) => {
      qc.invalidateQueries({ queryKey: queryKeys.marketplaceListings.all(scope) });
      options?.onSuccess?.(data, variables, undefined, context as never);
    },
    ...defaultMutationRetry,
    ...options,
  });
}

export function useUpdateListingStatus(
  scope: TenantScopeArg,
  options?: DefaultMutationOptions<MarketplaceListing, UpdateListingStatusInput>,
) {
  const qc = useQueryClient();
  return useMutation<MarketplaceListing, ApiClientError, UpdateListingStatusInput>({
    mutationFn: async ({ id, status }) => {
      const res = await client().put<MarketplaceListing>(`${BASE}/${id}/status`, {
        status,
      });
      return res.data;
    },
    onSuccess: (data, variables, context) => {
      qc.invalidateQueries({ queryKey: queryKeys.marketplaceListings.all(scope) });
      qc.invalidateQueries({
        queryKey: queryKeys.marketplaceListings.detail(scope, variables.id),
      });
      options?.onSuccess?.(data, variables, undefined, context as never);
    },
    ...defaultMutationRetry,
    ...options,
  });
}
