/**
 * Renewals hooks.
 *
 * Endpoints:
 *   GET  /renewals                               → list (scoped)
 *   POST /renewals/:leaseId/window               → open renewal window
 *   POST /renewals/:leaseId/propose              → propose rent
 *   POST /renewals/:leaseId/accept               → accept
 *   POST /renewals/:leaseId/decline              → decline
 *   POST /renewals/:leaseId/terminate            → terminate
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

export type RenewalStatus =
  | 'window_open'
  | 'proposed'
  | 'accepted'
  | 'declined'
  | 'terminated'
  | 'expired';

export interface Renewal {
  readonly leaseId: string;
  readonly tenantId: string;
  readonly status: RenewalStatus;
  readonly currentRent: number;
  readonly proposedRent?: number;
  readonly currentEndDate: string;
  readonly newEndDate?: string;
  readonly windowOpenedAt?: string;
  readonly proposedAt?: string;
  readonly resolvedAt?: string;
}

export interface RenewalFilters {
  readonly status?: RenewalStatus;
  readonly limit?: number;
  readonly offset?: number;
}

export interface OpenRenewalWindowInput {
  readonly leaseId: string;
}

export interface ProposeRenewalInput {
  readonly leaseId: string;
  readonly proposedRent: number;
}

export interface AcceptRenewalInput {
  readonly leaseId: string;
  readonly newEndDate: string;
}

export interface DeclineRenewalInput {
  readonly leaseId: string;
  readonly reason?: string;
}

const BASE = '/renewals';

export function useRenewals(
  scope: TenantScopeArg,
  filters?: RenewalFilters,
  options?: DefaultQueryOptions<ReadonlyArray<Renewal>>,
) {
  return useQuery<ReadonlyArray<Renewal>, ApiClientError>({
    queryKey: queryKeys.renewals.list(scope, filters as Record<string, unknown> | undefined),
    queryFn: async () => {
      const res = await client().get<ReadonlyArray<Renewal>>(BASE, {
        params: compact(filters as Record<string, unknown>) as Record<string, string | number | boolean>,
      });
      return res.data;
    },
    ...defaultQueryRetry,
    ...options,
  });
}

export function useOpenRenewalWindow(
  scope: TenantScopeArg,
  options?: DefaultMutationOptions<Renewal, OpenRenewalWindowInput>,
) {
  const qc = useQueryClient();
  return useMutation<Renewal, ApiClientError, OpenRenewalWindowInput>({
    mutationFn: async ({ leaseId }) => {
      const res = await client().post<Renewal>(`${BASE}/${leaseId}/window`, {});
      return res.data;
    },
    onSuccess: (data, variables, context) => {
      qc.invalidateQueries({ queryKey: queryKeys.renewals.all(scope) });
      qc.invalidateQueries({
        queryKey: queryKeys.renewals.detail(scope, variables.leaseId),
      });
      options?.onSuccess?.(data, variables, undefined, context as never);
    },
    ...defaultMutationRetry,
    ...options,
  });
}

export function useProposeRenewal(
  scope: TenantScopeArg,
  options?: DefaultMutationOptions<Renewal, ProposeRenewalInput>,
) {
  const qc = useQueryClient();
  return useMutation<Renewal, ApiClientError, ProposeRenewalInput>({
    mutationFn: async ({ leaseId, proposedRent }) => {
      const res = await client().post<Renewal>(`${BASE}/${leaseId}/propose`, {
        proposedRent,
      });
      return res.data;
    },
    onSuccess: (data, variables, context) => {
      qc.invalidateQueries({
        queryKey: queryKeys.renewals.detail(scope, variables.leaseId),
      });
      options?.onSuccess?.(data, variables, undefined, context as never);
    },
    ...defaultMutationRetry,
    ...options,
  });
}

export function useAcceptRenewal(
  scope: TenantScopeArg,
  options?: DefaultMutationOptions<Renewal, AcceptRenewalInput>,
) {
  const qc = useQueryClient();
  return useMutation<Renewal, ApiClientError, AcceptRenewalInput>({
    mutationFn: async ({ leaseId, newEndDate }) => {
      const res = await client().post<Renewal>(`${BASE}/${leaseId}/accept`, {
        newEndDate,
      });
      return res.data;
    },
    onSuccess: (data, variables, context) => {
      qc.invalidateQueries({ queryKey: queryKeys.renewals.all(scope) });
      qc.invalidateQueries({
        queryKey: queryKeys.renewals.detail(scope, variables.leaseId),
      });
      options?.onSuccess?.(data, variables, undefined, context as never);
    },
    ...defaultMutationRetry,
    ...options,
  });
}

export function useDeclineRenewal(
  scope: TenantScopeArg,
  options?: DefaultMutationOptions<Renewal, DeclineRenewalInput>,
) {
  const qc = useQueryClient();
  return useMutation<Renewal, ApiClientError, DeclineRenewalInput>({
    mutationFn: async ({ leaseId, reason }) => {
      const res = await client().post<Renewal>(`${BASE}/${leaseId}/decline`, {
        reason,
      });
      return res.data;
    },
    onSuccess: (data, variables, context) => {
      qc.invalidateQueries({ queryKey: queryKeys.renewals.all(scope) });
      qc.invalidateQueries({
        queryKey: queryKeys.renewals.detail(scope, variables.leaseId),
      });
      options?.onSuccess?.(data, variables, undefined, context as never);
    },
    ...defaultMutationRetry,
    ...options,
  });
}
