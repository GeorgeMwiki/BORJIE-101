/**
 * Tenders hooks.
 *
 * Endpoints:
 *   POST /tenders                  → publish
 *   GET  /tenders/:id              → detail
 *   POST /tenders/:id/bids         → submit bid
 *   GET  /tenders/:id/bids         → list bids
 *   POST /tenders/:id/award        → award
 *   POST /tenders/:id/cancel       → cancel
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { ApiClientError } from '../client';
import { queryKeys } from './query-keys';
import {
  client,
  defaultMutationRetry,
  defaultQueryRetry,
  type DefaultMutationOptions,
  type DefaultQueryOptions,
  type TenantScopeArg,
} from './shared';

export type TenderStatus = 'open' | 'closed' | 'awarded' | 'cancelled';

export interface Tender {
  readonly id: string;
  readonly tenantId: string;
  readonly scope: string;
  readonly details?: string;
  readonly budgetRangeMin: number;
  readonly budgetRangeMax: number;
  readonly currency: string;
  readonly visibility: 'public' | 'invite_only';
  readonly status: TenderStatus;
  readonly closesAt: string;
  readonly workOrderId?: string;
  readonly createdAt: string;
}

export interface TenderBid {
  readonly id: string;
  readonly tenderId: string;
  readonly vendorId: string;
  readonly price: number;
  readonly currency: string;
  readonly timelineDays: number;
  readonly notes?: string;
  readonly submittedAt: string;
}

export interface PublishTenderInput {
  readonly scope: string;
  readonly details?: string;
  readonly budgetRangeMin: number;
  readonly budgetRangeMax: number;
  readonly currency?: string;
  readonly visibility?: 'public' | 'invite_only';
  readonly invitedVendorIds?: ReadonlyArray<string>;
  readonly workOrderId?: string;
  readonly aiNegotiatorEnabled?: boolean;
  readonly negotiationPolicyId?: string;
  readonly closesAt: string;
}

export interface SubmitBidInput {
  readonly tenderId: string;
  readonly vendorId: string;
  readonly price: number;
  readonly currency?: string;
  readonly timelineDays: number;
  readonly notes?: string;
}

export interface AwardTenderInput {
  readonly tenderId: string;
  readonly bidId: string;
  readonly reason?: string;
}

const BASE = '/tenders';

export function useTender(
  scope: TenantScopeArg,
  id: string,
  options?: DefaultQueryOptions<Tender>,
) {
  return useQuery<Tender, ApiClientError>({
    queryKey: queryKeys.tenders.detail(scope, id),
    queryFn: async () => {
      const res = await client().get<Tender>(`${BASE}/${id}`);
      return res.data;
    },
    enabled: Boolean(id),
    ...defaultQueryRetry,
    ...options,
  });
}

export function useTenderBids(
  scope: TenantScopeArg,
  tenderId: string,
  options?: DefaultQueryOptions<ReadonlyArray<TenderBid>>,
) {
  return useQuery<ReadonlyArray<TenderBid>, ApiClientError>({
    queryKey: queryKeys.tenders.bids(scope, tenderId),
    queryFn: async () => {
      const res = await client().get<ReadonlyArray<TenderBid>>(
        `${BASE}/${tenderId}/bids`,
      );
      return res.data;
    },
    enabled: Boolean(tenderId),
    ...defaultQueryRetry,
    ...options,
  });
}

export function usePublishTender(
  scope: TenantScopeArg,
  options?: DefaultMutationOptions<Tender, PublishTenderInput>,
) {
  const qc = useQueryClient();
  return useMutation<Tender, ApiClientError, PublishTenderInput>({
    mutationFn: async (input) => {
      const res = await client().post<Tender>(BASE, input);
      return res.data;
    },
    onSuccess: (data, variables, context) => {
      qc.invalidateQueries({ queryKey: queryKeys.tenders.all(scope) });
      options?.onSuccess?.(data, variables, undefined, context as never);
    },
    ...defaultMutationRetry,
    ...options,
  });
}

export function useSubmitBid(
  scope: TenantScopeArg,
  options?: DefaultMutationOptions<TenderBid, SubmitBidInput>,
) {
  const qc = useQueryClient();
  return useMutation<TenderBid, ApiClientError, SubmitBidInput>({
    mutationFn: async ({ tenderId, ...body }) => {
      const res = await client().post<TenderBid>(`${BASE}/${tenderId}/bids`, body);
      return res.data;
    },
    onSuccess: (data, variables, context) => {
      qc.invalidateQueries({
        queryKey: queryKeys.tenders.bids(scope, variables.tenderId),
      });
      options?.onSuccess?.(data, variables, undefined, context as never);
    },
    ...defaultMutationRetry,
    ...options,
  });
}

export function useAwardTender(
  scope: TenantScopeArg,
  options?: DefaultMutationOptions<Tender, AwardTenderInput>,
) {
  const qc = useQueryClient();
  return useMutation<Tender, ApiClientError, AwardTenderInput>({
    mutationFn: async ({ tenderId, bidId, reason }) => {
      const res = await client().post<Tender>(`${BASE}/${tenderId}/award`, {
        bidId,
        reason,
      });
      return res.data;
    },
    onSuccess: (data, variables, context) => {
      qc.invalidateQueries({ queryKey: queryKeys.tenders.all(scope) });
      qc.invalidateQueries({
        queryKey: queryKeys.tenders.detail(scope, variables.tenderId),
      });
      options?.onSuccess?.(data, variables, undefined, context as never);
    },
    ...defaultMutationRetry,
    ...options,
  });
}
