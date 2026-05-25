/**
 * Arrears hooks.
 *
 * Endpoints:
 *   GET  /arrears/cases/:id/projection
 *   POST /arrears/cases
 *   POST /arrears/cases/:id/propose
 *   POST /arrears/proposals/:proposalId/approve
 *   POST /arrears/proposals/:proposalId/reject
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

export type ArrearsProposalKind =
  | 'waiver'
  | 'writeoff'
  | 'late_fee'
  | 'adjustment'
  | 'correction';

export interface ArrearsProjection {
  readonly tenantId: string;
  readonly arrearsCaseId: string;
  readonly customerId: string;
  readonly currency: string;
  readonly currentBalanceMinor: number;
  readonly projectedBalanceMinor: number;
  readonly asOf: string;
}

export interface ArrearsCase {
  readonly id: string;
  readonly tenantId: string;
  readonly customerId: string;
  readonly currency: string;
  readonly totalArrearsAmount: number;
  readonly daysOverdue: number;
  readonly overdueInvoiceCount: number;
  readonly oldestInvoiceDate: string;
  readonly status: 'open' | 'resolving' | 'closed';
}

export interface ArrearsProposal {
  readonly id: string;
  readonly tenantId: string;
  readonly arrearsCaseId: string;
  readonly customerId: string;
  readonly kind: ArrearsProposalKind;
  readonly amountMinorUnits: number;
  readonly currency: string;
  readonly status: 'pending' | 'approved' | 'rejected';
  readonly reason: string;
  readonly proposedAt: string;
}

export interface OpenArrearsCaseInput {
  readonly customerId: string;
  readonly currency: string;
  readonly totalArrearsAmount: number;
  readonly daysOverdue: number;
  readonly overdueInvoiceCount: number;
  readonly oldestInvoiceDate: string;
  readonly leaseId?: string;
  readonly propertyId?: string;
  readonly unitId?: string;
  readonly notes?: string;
}

export interface ProposeArrearsInput {
  readonly caseId: string;
  readonly customerId: string;
  readonly invoiceId?: string;
  readonly kind: ArrearsProposalKind;
  readonly amountMinorUnits: number;
  readonly currency: string;
  readonly reason: string;
  readonly evidenceDocIds?: ReadonlyArray<string>;
  readonly balanceBeforeMinorUnits?: number;
}

export interface ApproveArrearsInput {
  readonly proposalId: string;
  readonly approvalNotes?: string;
}

const BASE = '/arrears';

export function useArrearsProjection(
  scope: TenantScopeArg,
  caseId: string,
  options?: DefaultQueryOptions<ArrearsProjection>,
) {
  return useQuery<ArrearsProjection, ApiClientError>({
    queryKey: queryKeys.arrears.projection(scope, caseId),
    queryFn: async () => {
      const res = await client().get<ArrearsProjection>(
        `${BASE}/cases/${caseId}/projection`,
      );
      return res.data;
    },
    enabled: Boolean(caseId),
    ...defaultQueryRetry,
    ...options,
  });
}

export function useOpenArrearsCase(
  scope: TenantScopeArg,
  options?: DefaultMutationOptions<ArrearsCase, OpenArrearsCaseInput>,
) {
  const qc = useQueryClient();
  return useMutation<ArrearsCase, ApiClientError, OpenArrearsCaseInput>({
    mutationFn: async (input) => {
      const res = await client().post<ArrearsCase>(`${BASE}/cases`, input);
      return res.data;
    },
    onSuccess: (data, variables, context) => {
      qc.invalidateQueries({ queryKey: queryKeys.arrears.all(scope) });
      options?.onSuccess?.(data, variables, undefined, context as never);
    },
    ...defaultMutationRetry,
    ...options,
  });
}

export function useProposeArrears(
  scope: TenantScopeArg,
  options?: DefaultMutationOptions<ArrearsProposal, ProposeArrearsInput>,
) {
  const qc = useQueryClient();
  return useMutation<ArrearsProposal, ApiClientError, ProposeArrearsInput>({
    mutationFn: async ({ caseId, ...body }) => {
      const res = await client().post<ArrearsProposal>(
        `${BASE}/cases/${caseId}/propose`,
        body,
      );
      return res.data;
    },
    onSuccess: (data, variables, context) => {
      qc.invalidateQueries({
        queryKey: queryKeys.arrears.projection(scope, variables.caseId),
      });
      options?.onSuccess?.(data, variables, undefined, context as never);
    },
    ...defaultMutationRetry,
    ...options,
  });
}

export function useApproveArrearsProposal(
  scope: TenantScopeArg,
  options?: DefaultMutationOptions<ArrearsProposal, ApproveArrearsInput>,
) {
  const qc = useQueryClient();
  return useMutation<ArrearsProposal, ApiClientError, ApproveArrearsInput>({
    mutationFn: async ({ proposalId, approvalNotes }) => {
      const res = await client().post<ArrearsProposal>(
        `${BASE}/proposals/${proposalId}/approve`,
        { approvalNotes },
      );
      return res.data;
    },
    onSuccess: (data, variables, context) => {
      qc.invalidateQueries({ queryKey: queryKeys.arrears.all(scope) });
      options?.onSuccess?.(data, variables, undefined, context as never);
    },
    ...defaultMutationRetry,
    ...options,
  });
}
