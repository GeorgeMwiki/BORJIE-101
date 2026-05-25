/**
 * Compliance hooks.
 *
 * Endpoints:
 *   POST /compliance/exports                     → schedule
 *   POST /compliance/exports/:id/generate        → generate now
 *   GET  /compliance/exports/:id/download        → signed URL
 *   GET  /compliance/exports                     → list (once read path lands)
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

export type ComplianceExportType =
  | 'tz_tra'
  | 'ke_dpa'
  | 'ke_kra'
  | 'tz_land_act';

export interface ComplianceExportManifest {
  readonly id: string;
  readonly tenantId: string;
  readonly exportType: ComplianceExportType;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly status: 'scheduled' | 'generating' | 'ready' | 'failed';
  readonly rowCount?: number;
  readonly scheduledAt: string;
  readonly generatedAt?: string;
  readonly requestedBy: string;
}

export interface ComplianceExportDownload {
  readonly url: string;
  readonly manifest: ComplianceExportManifest;
}

export interface ComplianceExportFilters {
  readonly exportType?: ComplianceExportType;
  readonly status?: ComplianceExportManifest['status'];
  readonly limit?: number;
  readonly offset?: number;
}

export interface ScheduleComplianceExportInput {
  readonly exportType: ComplianceExportType;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly regulatorContext?: Record<string, unknown>;
}

const BASE = '/compliance';

export function useComplianceExports(
  scope: TenantScopeArg,
  filters?: ComplianceExportFilters,
  options?: DefaultQueryOptions<ReadonlyArray<ComplianceExportManifest>>,
) {
  return useQuery<ReadonlyArray<ComplianceExportManifest>, ApiClientError>({
    queryKey: queryKeys.compliance.exports(
      scope,
      filters as Record<string, unknown> | undefined,
    ),
    queryFn: async () => {
      const res = await client().get<ReadonlyArray<ComplianceExportManifest>>(
        `${BASE}/exports`,
        { params: compact(filters as Record<string, unknown>) as Record<string, string | number | boolean> },
      );
      return res.data;
    },
    ...defaultQueryRetry,
    ...options,
  });
}

export function useScheduleComplianceExport(
  scope: TenantScopeArg,
  options?: DefaultMutationOptions<
    ComplianceExportManifest,
    ScheduleComplianceExportInput
  >,
) {
  const qc = useQueryClient();
  return useMutation<
    ComplianceExportManifest,
    ApiClientError,
    ScheduleComplianceExportInput
  >({
    mutationFn: async (input) => {
      const res = await client().post<ComplianceExportManifest>(
        `${BASE}/exports`,
        input,
      );
      return res.data;
    },
    onSuccess: (data, variables, context) => {
      qc.invalidateQueries({ queryKey: queryKeys.compliance.all(scope) });
      options?.onSuccess?.(data, variables, undefined, context as never);
    },
    ...defaultMutationRetry,
    ...options,
  });
}

export function useDownloadComplianceExport(
  scope: TenantScopeArg,
  options?: DefaultMutationOptions<
    ComplianceExportDownload,
    { readonly id: string }
  >,
) {
  return useMutation<
    ComplianceExportDownload,
    ApiClientError,
    { readonly id: string }
  >({
    mutationFn: async ({ id }) => {
      const res = await client().get<ComplianceExportDownload>(
        `${BASE}/exports/${id}/download`,
      );
      return res.data;
    },
    ...defaultMutationRetry,
    ...options,
  });
}
