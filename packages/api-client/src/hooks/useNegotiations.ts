/**
 * Negotiations hooks.
 *
 * Endpoints:
 *   GET  /negotiations                    → list (scoped)
 *   POST /negotiations                    → start
 *   POST /negotiations/:id/turns          → submit counter
 *   POST /negotiations/:id/accept         → accept
 *   POST /negotiations/:id/reject         → reject
 *   GET  /negotiations/:id/audit          → audit trail
 *   POST /negotiations/policies           → create policy
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

export type NegotiationStatus =
  | 'active'
  | 'pending'
  | 'countered'
  | 'accepted'
  | 'rejected'
  | 'expired';

export interface Negotiation {
  readonly id: string;
  readonly tenantId: string;
  readonly unitId?: string;
  readonly listingId?: string;
  readonly prospectCustomerId: string;
  readonly currentOffer: number;
  readonly askingPrice: number;
  readonly status: NegotiationStatus;
  readonly lastTurnAt: string;
  readonly createdAt: string;
}

export interface NegotiationFilters {
  readonly status?: NegotiationStatus;
  readonly unitId?: string;
  readonly listingId?: string;
  readonly limit?: number;
  readonly offset?: number;
}

export interface StartNegotiationInput {
  readonly listingId?: string;
  readonly unitId?: string;
  readonly prospectCustomerId: string;
  readonly openingOffer: number;
  readonly message?: string;
}

export interface CounterNegotiationInput {
  readonly id: string;
  readonly actor: 'owner' | 'prospect' | 'ai';
  readonly offer: number;
  readonly concessions?: Record<string, unknown>;
  readonly rationale?: string;
}

export interface CloseNegotiationInput {
  readonly id: string;
  readonly actor: 'owner' | 'prospect' | 'ai';
  readonly agreedPrice?: number;
  readonly reason?: string;
}

export interface NegotiationAuditEntry {
  readonly id: string;
  readonly negotiationId: string;
  readonly actor: string;
  readonly action: string;
  readonly payload: Record<string, unknown>;
  readonly at: string;
}

const BASE = '/negotiations';

export function useNegotiations(
  scope: TenantScopeArg,
  filters?: NegotiationFilters,
  options?: DefaultQueryOptions<ReadonlyArray<Negotiation>>,
) {
  return useQuery<ReadonlyArray<Negotiation>, ApiClientError>({
    queryKey: queryKeys.negotiations.list(scope, filters as Record<string, unknown> | undefined),
    queryFn: async () => {
      const res = await client().get<ReadonlyArray<Negotiation>>(BASE, {
        params: compact(filters as Record<string, unknown>) as Record<string, string | number | boolean>,
      });
      return res.data;
    },
    ...defaultQueryRetry,
    ...options,
  });
}

export function useNegotiationAudit(
  scope: TenantScopeArg,
  id: string,
  options?: DefaultQueryOptions<ReadonlyArray<NegotiationAuditEntry>>,
) {
  return useQuery<ReadonlyArray<NegotiationAuditEntry>, ApiClientError>({
    queryKey: queryKeys.negotiations.audit(scope, id),
    queryFn: async () => {
      const res = await client().get<ReadonlyArray<NegotiationAuditEntry>>(
        `${BASE}/${id}/audit`,
      );
      return res.data;
    },
    enabled: Boolean(id),
    ...defaultQueryRetry,
    ...options,
  });
}

export function useStartNegotiation(
  scope: TenantScopeArg,
  options?: DefaultMutationOptions<Negotiation, StartNegotiationInput>,
) {
  const qc = useQueryClient();
  return useMutation<Negotiation, ApiClientError, StartNegotiationInput>({
    mutationFn: async (input) => {
      const res = await client().post<Negotiation>(BASE, input);
      return res.data;
    },
    onSuccess: (data, variables, context) => {
      qc.invalidateQueries({ queryKey: queryKeys.negotiations.all(scope) });
      options?.onSuccess?.(data, variables, undefined, context as never);
    },
    ...defaultMutationRetry,
    ...options,
  });
}

export function useCounterNegotiation(
  scope: TenantScopeArg,
  options?: DefaultMutationOptions<Negotiation, CounterNegotiationInput>,
) {
  const qc = useQueryClient();
  return useMutation<Negotiation, ApiClientError, CounterNegotiationInput>({
    mutationFn: async ({ id, ...body }) => {
      const res = await client().post<Negotiation>(`${BASE}/${id}/turns`, body);
      return res.data;
    },
    onSuccess: (data, variables, context) => {
      qc.invalidateQueries({ queryKey: queryKeys.negotiations.all(scope) });
      qc.invalidateQueries({
        queryKey: queryKeys.negotiations.audit(scope, variables.id),
      });
      options?.onSuccess?.(data, variables, undefined, context as never);
    },
    ...defaultMutationRetry,
    ...options,
  });
}

export function useAcceptNegotiation(
  scope: TenantScopeArg,
  options?: DefaultMutationOptions<Negotiation, CloseNegotiationInput>,
) {
  const qc = useQueryClient();
  return useMutation<Negotiation, ApiClientError, CloseNegotiationInput>({
    mutationFn: async ({ id, ...body }) => {
      const res = await client().post<Negotiation>(`${BASE}/${id}/accept`, body);
      return res.data;
    },
    onSuccess: (data, variables, context) => {
      qc.invalidateQueries({ queryKey: queryKeys.negotiations.all(scope) });
      qc.invalidateQueries({
        queryKey: queryKeys.negotiations.audit(scope, variables.id),
      });
      options?.onSuccess?.(data, variables, undefined, context as never);
    },
    ...defaultMutationRetry,
    ...options,
  });
}

export function useRejectNegotiation(
  scope: TenantScopeArg,
  options?: DefaultMutationOptions<Negotiation, CloseNegotiationInput>,
) {
  const qc = useQueryClient();
  return useMutation<Negotiation, ApiClientError, CloseNegotiationInput>({
    mutationFn: async ({ id, ...body }) => {
      const res = await client().post<Negotiation>(`${BASE}/${id}/reject`, body);
      return res.data;
    },
    onSuccess: (data, variables, context) => {
      qc.invalidateQueries({ queryKey: queryKeys.negotiations.all(scope) });
      qc.invalidateQueries({
        queryKey: queryKeys.negotiations.audit(scope, variables.id),
      });
      options?.onSuccess?.(data, variables, undefined, context as never);
    },
    ...defaultMutationRetry,
    ...options,
  });
}
