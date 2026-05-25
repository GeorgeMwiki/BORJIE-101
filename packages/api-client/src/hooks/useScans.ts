/**
 * Scans hooks.
 *
 * Endpoints:
 *   POST /scans/bundles                     → create
 *   POST /scans/bundles/:id/pages           → upload page
 *   POST /scans/bundles/:id/ocr             → trigger OCR
 *   POST /scans/bundles/:id/submit          → assemble
 *   GET  /scans/bundles/:id                 → detail
 *   GET  /scans/bundles                     → list
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

export interface ScanBundle {
  readonly id: string;
  readonly tenantId: string;
  readonly title?: string;
  readonly purpose?: string;
  readonly pageCount: number;
  readonly status:
    | 'empty'
    | 'in_progress'
    | 'ocr_pending'
    | 'ocr_complete'
    | 'submitted'
    | 'linked';
  readonly linkedDocumentId?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ScanBundleListFilters {
  readonly status?: ScanBundle['status'];
  readonly limit?: number;
  readonly offset?: number;
}

export interface CreateScanBundleInput {
  readonly title?: string;
  readonly purpose?: string;
}

export interface UploadScanPageInput {
  readonly bundleId: string;
  readonly dataUrl: string;
  readonly mimeType?: string;
  readonly widthPx?: number;
  readonly heightPx?: number;
  readonly quad?: ReadonlyArray<{ readonly x: number; readonly y: number }>;
}

export interface SubmitScanBundleInput {
  readonly bundleId: string;
}

const BASE = '/scans';

export function useScanBundles(
  scope: TenantScopeArg,
  filters?: ScanBundleListFilters,
  options?: DefaultQueryOptions<ReadonlyArray<ScanBundle>>,
) {
  return useQuery<ReadonlyArray<ScanBundle>, ApiClientError>({
    queryKey: queryKeys.scans.list(scope, filters as Record<string, unknown> | undefined),
    queryFn: async () => {
      const res = await client().get<ReadonlyArray<ScanBundle>>(
        `${BASE}/bundles`,
        { params: compact(filters as Record<string, unknown>) as Record<string, string | number | boolean> },
      );
      return res.data;
    },
    ...defaultQueryRetry,
    ...options,
  });
}

export function useScanBundle(
  scope: TenantScopeArg,
  id: string,
  options?: DefaultQueryOptions<ScanBundle>,
) {
  return useQuery<ScanBundle, ApiClientError>({
    queryKey: queryKeys.scans.detail(scope, id),
    queryFn: async () => {
      const res = await client().get<ScanBundle>(`${BASE}/bundles/${id}`);
      return res.data;
    },
    enabled: Boolean(id),
    ...defaultQueryRetry,
    ...options,
  });
}

export function useCreateScanBundle(
  scope: TenantScopeArg,
  options?: DefaultMutationOptions<ScanBundle, CreateScanBundleInput>,
) {
  const qc = useQueryClient();
  return useMutation<ScanBundle, ApiClientError, CreateScanBundleInput>({
    mutationFn: async (input) => {
      const res = await client().post<ScanBundle>(`${BASE}/bundles`, input);
      return res.data;
    },
    onSuccess: (data, variables, context) => {
      qc.invalidateQueries({ queryKey: queryKeys.scans.all(scope) });
      options?.onSuccess?.(data, variables, undefined, context as never);
    },
    ...defaultMutationRetry,
    ...options,
  });
}

export function useUploadScanPage(
  scope: TenantScopeArg,
  options?: DefaultMutationOptions<ScanBundle, UploadScanPageInput>,
) {
  const qc = useQueryClient();
  return useMutation<ScanBundle, ApiClientError, UploadScanPageInput>({
    mutationFn: async ({ bundleId, ...body }) => {
      const res = await client().post<ScanBundle>(
        `${BASE}/bundles/${bundleId}/pages`,
        body,
      );
      return res.data;
    },
    onSuccess: (data, variables, context) => {
      qc.invalidateQueries({
        queryKey: queryKeys.scans.detail(scope, variables.bundleId),
      });
      options?.onSuccess?.(data, variables, undefined, context as never);
    },
    ...defaultMutationRetry,
    ...options,
  });
}

export function useSubmitScanBundle(
  scope: TenantScopeArg,
  options?: DefaultMutationOptions<ScanBundle, SubmitScanBundleInput>,
) {
  const qc = useQueryClient();
  return useMutation<ScanBundle, ApiClientError, SubmitScanBundleInput>({
    mutationFn: async ({ bundleId }) => {
      const res = await client().post<ScanBundle>(
        `${BASE}/bundles/${bundleId}/submit`,
        {},
      );
      return res.data;
    },
    onSuccess: (data, variables, context) => {
      qc.invalidateQueries({ queryKey: queryKeys.scans.all(scope) });
      qc.invalidateQueries({
        queryKey: queryKeys.scans.detail(scope, variables.bundleId),
      });
      options?.onSuccess?.(data, variables, undefined, context as never);
    },
    ...defaultMutationRetry,
    ...options,
  });
}
