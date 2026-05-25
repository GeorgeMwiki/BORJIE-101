/**
 * Migration Wizard hooks.
 *
 * Endpoints:
 *   POST /migration/upload
 *   POST /migration/:runId/commit
 *   POST /migration/:runId/ask
 *   GET  /migration/:runId             (exposed by follow-up wiring)
 *
 * The upload endpoint consumes FormData, not JSON. The hook wraps that
 * in a `File`-accepting mutation so callers don't have to hand-roll
 * multipart bodies.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiClientError, getApiClient } from '../client';
import { queryKeys } from './query-keys';
import {
  client,
  defaultMutationRetry,
  defaultQueryRetry,
  type DefaultMutationOptions,
  type DefaultQueryOptions,
  type TenantScopeArg,
} from './shared';

export interface MigrationBundle {
  readonly properties: ReadonlyArray<Record<string, unknown>>;
  readonly units: ReadonlyArray<Record<string, unknown>>;
  readonly tenants: ReadonlyArray<Record<string, unknown>>;
  readonly employees: ReadonlyArray<Record<string, unknown>>;
  readonly departments: ReadonlyArray<Record<string, unknown>>;
  readonly teams: ReadonlyArray<Record<string, unknown>>;
}

export interface MigrationRun {
  readonly id: string;
  readonly tenantId: string;
  readonly createdBy: string;
  readonly status:
    | 'created'
    | 'extracted'
    | 'validated'
    | 'committed'
    | 'failed';
  readonly uploadFilename: string;
  readonly uploadMimeType: string;
  readonly uploadSizeBytes: number;
  readonly bundle?: MigrationBundle;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface MigrationUploadResponse {
  readonly runId: string;
  readonly bundle: MigrationBundle;
  readonly warnings: ReadonlyArray<string>;
}

export interface MigrationCommitResponse {
  readonly ok: true;
  readonly runId: string;
  readonly counts: Record<string, number>;
  readonly skipped: Record<string, number>;
}

export interface MigrationAskResponse {
  readonly runId: string;
  readonly ack: boolean;
  readonly note?: string;
}

const BASE = '/migration';

export function useMigrationRun(
  scope: TenantScopeArg,
  runId: string,
  options?: DefaultQueryOptions<MigrationRun>,
) {
  return useQuery<MigrationRun, ApiClientError>({
    queryKey: queryKeys.migration.run(scope, runId),
    queryFn: async () => {
      const res = await client().get<MigrationRun>(`${BASE}/${runId}`);
      return res.data;
    },
    enabled: Boolean(runId),
    ...defaultQueryRetry,
    ...options,
  });
}

export function useMigrationUpload(
  scope: TenantScopeArg,
  options?: DefaultMutationOptions<MigrationUploadResponse, { readonly file: File }>,
) {
  const qc = useQueryClient();
  return useMutation<MigrationUploadResponse, ApiClientError, { readonly file: File }>({
    mutationFn: async ({ file }) => {
      const form = new FormData();
      form.append('file', file);
      // Multipart uploads bypass the ApiClient JSON serializer — use
      // fetch directly via the client's base URL and token.
      const c = getApiClient();
      const token = c.getAccessToken();
      const baseUrl = (c as unknown as { config: { baseUrl: string } }).config.baseUrl;
      const response = await fetch(`${baseUrl}${BASE}/upload`, {
        method: 'POST',
        body: form,
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (!response.ok) {
        throw new ApiClientError('UPLOAD_FAILED', 'Migration upload failed', {
          status: response.status,
        });
      }
      return (await response.json()) as MigrationUploadResponse;
    },
    onSuccess: (data, variables, context) => {
      qc.invalidateQueries({ queryKey: queryKeys.migration.all(scope) });
      options?.onSuccess?.(data, variables, undefined, context as never);
    },
    ...defaultMutationRetry,
    ...options,
  });
}

export function useMigrationCommit(
  scope: TenantScopeArg,
  options?: DefaultMutationOptions<MigrationCommitResponse, { readonly runId: string }>,
) {
  const qc = useQueryClient();
  return useMutation<MigrationCommitResponse, ApiClientError, { readonly runId: string }>({
    mutationFn: async ({ runId }) => {
      const res = await client().post<MigrationCommitResponse>(
        `${BASE}/${runId}/commit`,
        {},
      );
      return res.data;
    },
    onSuccess: (data, variables, context) => {
      qc.invalidateQueries({
        queryKey: queryKeys.migration.run(scope, variables.runId),
      });
      options?.onSuccess?.(data, variables, undefined, context as never);
    },
    ...defaultMutationRetry,
    ...options,
  });
}

export function useMigrationAsk(
  scope: TenantScopeArg,
  options?: DefaultMutationOptions<
    MigrationAskResponse,
    { readonly runId: string; readonly message: string }
  >,
) {
  return useMutation<
    MigrationAskResponse,
    ApiClientError,
    { readonly runId: string; readonly message: string }
  >({
    mutationFn: async ({ runId, message }) => {
      const res = await client().post<MigrationAskResponse>(
        `${BASE}/${runId}/ask`,
        { message },
      );
      return res.data;
    },
    ...defaultMutationRetry,
    ...options,
  });
}
