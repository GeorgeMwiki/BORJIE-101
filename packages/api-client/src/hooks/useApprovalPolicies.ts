/**
 * Approval Policies hooks.
 *
 * Endpoints:
 *   GET  /approval-policies           → list
 *   GET  /approval-policies/:id       → detail
 *   PUT  /approval-policies/:id       → upsert
 *
 * Note: approval-policies is currently reachable through the admin
 * portal; the router stub lives in domain-services/src/approvals. Until
 * a dedicated gateway router lands these hooks hit the canonical REST
 * path so the wiring is trivial once the router ships.
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

export interface ApprovalPolicy {
  readonly id: string;
  readonly tenantId: string;
  readonly name: string;
  readonly scope: 'arrears' | 'negotiation' | 'letter' | 'tender' | 'global';
  readonly thresholds: Record<string, unknown>;
  readonly approvers: ReadonlyArray<{
    readonly role: string;
    readonly minCount: number;
  }>;
  readonly active: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ApprovalPolicyFilters {
  readonly scope?: ApprovalPolicy['scope'];
  readonly active?: boolean;
}

export interface UpsertApprovalPolicyInput {
  readonly id: string;
  readonly name: string;
  readonly scope: ApprovalPolicy['scope'];
  readonly thresholds: Record<string, unknown>;
  readonly approvers: ReadonlyArray<{ readonly role: string; readonly minCount: number }>;
  readonly active: boolean;
}

const BASE = '/approval-policies';

export function useApprovalPolicies(
  scope: TenantScopeArg,
  filters?: ApprovalPolicyFilters,
  options?: DefaultQueryOptions<ReadonlyArray<ApprovalPolicy>>,
) {
  return useQuery<ReadonlyArray<ApprovalPolicy>, ApiClientError>({
    queryKey: queryKeys.approvalPolicies.list(scope, filters as Record<string, unknown> | undefined),
    queryFn: async () => {
      const res = await client().get<ReadonlyArray<ApprovalPolicy>>(BASE, {
        params: compact(filters as Record<string, unknown>) as Record<string, string | number | boolean>,
      });
      return res.data;
    },
    ...defaultQueryRetry,
    ...options,
  });
}

export function useApprovalPolicy(
  scope: TenantScopeArg,
  id: string,
  options?: DefaultQueryOptions<ApprovalPolicy>,
) {
  return useQuery<ApprovalPolicy, ApiClientError>({
    queryKey: queryKeys.approvalPolicies.detail(scope, id),
    queryFn: async () => {
      const res = await client().get<ApprovalPolicy>(`${BASE}/${id}`);
      return res.data;
    },
    enabled: Boolean(id),
    ...defaultQueryRetry,
    ...options,
  });
}

export function useUpsertApprovalPolicy(
  scope: TenantScopeArg,
  options?: DefaultMutationOptions<ApprovalPolicy, UpsertApprovalPolicyInput>,
) {
  const qc = useQueryClient();
  return useMutation<ApprovalPolicy, ApiClientError, UpsertApprovalPolicyInput>({
    mutationFn: async (input) => {
      const res = await client().put<ApprovalPolicy>(`${BASE}/${input.id}`, input);
      return res.data;
    },
    onSuccess: (data, variables, context) => {
      qc.invalidateQueries({ queryKey: queryKeys.approvalPolicies.all(scope) });
      options?.onSuccess?.(data, variables, undefined, context as never);
    },
    ...defaultMutationRetry,
    ...options,
  });
}
