/**
 * Letter Requests hooks.
 *
 * Endpoints:
 *   POST /letters                         → createRequest
 *   POST /letters/:id/draft               → draft
 *   POST /letters/:id/submit-for-approval
 *   POST /letters/:id/approve
 *   POST /letters/:id/reject
 *   GET  /letters/:id/download            → signed URL
 *   GET  /letters/:id                     → detail
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

export type LetterType =
  | 'residency_proof'
  | 'tenancy_confirmation'
  | 'payment_confirmation'
  | 'tenant_reference';

export interface LetterRequest {
  readonly id: string;
  readonly tenantId: string;
  readonly letterType: LetterType;
  readonly customerId?: string;
  readonly status: 'draft' | 'pending_approval' | 'approved' | 'rejected' | 'issued';
  readonly payload: Record<string, unknown>;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface LetterDownload {
  readonly url: string;
  readonly expiresAt: string;
}

export interface CreateLetterRequestInput {
  readonly letterType: LetterType;
  readonly customerId?: string;
  readonly payload?: Record<string, unknown>;
}

export interface ApproveLetterInput {
  readonly id: string;
  readonly issuedDocumentId: string;
}

const BASE = '/letters';

export function useLetterRequest(
  scope: TenantScopeArg,
  id: string,
  options?: DefaultQueryOptions<LetterRequest>,
) {
  return useQuery<LetterRequest, ApiClientError>({
    queryKey: queryKeys.letterRequests.detail(scope, id),
    queryFn: async () => {
      const res = await client().get<LetterRequest>(`${BASE}/${id}`);
      return res.data;
    },
    enabled: Boolean(id),
    ...defaultQueryRetry,
    ...options,
  });
}

export function useCreateLetterRequest(
  scope: TenantScopeArg,
  options?: DefaultMutationOptions<LetterRequest, CreateLetterRequestInput>,
) {
  const qc = useQueryClient();
  return useMutation<LetterRequest, ApiClientError, CreateLetterRequestInput>({
    mutationFn: async (input) => {
      const res = await client().post<LetterRequest>(BASE, input);
      return res.data;
    },
    onSuccess: (data, variables, context) => {
      qc.invalidateQueries({ queryKey: queryKeys.letterRequests.all(scope) });
      options?.onSuccess?.(data, variables, undefined, context as never);
    },
    ...defaultMutationRetry,
    ...options,
  });
}

export function useApproveLetterRequest(
  scope: TenantScopeArg,
  options?: DefaultMutationOptions<LetterRequest, ApproveLetterInput>,
) {
  const qc = useQueryClient();
  return useMutation<LetterRequest, ApiClientError, ApproveLetterInput>({
    mutationFn: async ({ id, issuedDocumentId }) => {
      const res = await client().post<LetterRequest>(`${BASE}/${id}/approve`, {
        issuedDocumentId,
      });
      return res.data;
    },
    onSuccess: (data, variables, context) => {
      qc.invalidateQueries({ queryKey: queryKeys.letterRequests.all(scope) });
      qc.invalidateQueries({
        queryKey: queryKeys.letterRequests.detail(scope, variables.id),
      });
      options?.onSuccess?.(data, variables, undefined, context as never);
    },
    ...defaultMutationRetry,
    ...options,
  });
}

export function useDownloadLetter(
  scope: TenantScopeArg,
  options?: DefaultMutationOptions<LetterDownload, { readonly id: string }>,
) {
  return useMutation<LetterDownload, ApiClientError, { readonly id: string }>({
    mutationFn: async ({ id }) => {
      const res = await client().get<LetterDownload>(`${BASE}/${id}/download`);
      return res.data;
    },
    ...defaultMutationRetry,
    ...options,
  });
}
