/**
 * Risk Reports hooks.
 *
 * Endpoints:
 *   POST /risk-reports/:customerId/generate   → generate a new report
 *   GET  /risk-reports/:customerId/latest     → latest report
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

export interface RiskReport {
  readonly id: string;
  readonly tenantId: string;
  readonly customerId: string;
  readonly generatedAt: string;
  readonly generatedBy: string;
  readonly riskScore: number;
  readonly tier: 'low' | 'moderate' | 'elevated' | 'high';
  readonly signals: ReadonlyArray<{
    readonly kind: string;
    readonly weight: number;
    readonly value: unknown;
  }>;
  readonly summary: string;
}

const BASE = '/risk-reports';

export function useLatestRiskReport(
  scope: TenantScopeArg,
  customerId: string,
  options?: DefaultQueryOptions<RiskReport>,
) {
  return useQuery<RiskReport, ApiClientError>({
    queryKey: queryKeys.riskReports.latest(scope, customerId),
    queryFn: async () => {
      const res = await client().get<RiskReport>(
        `${BASE}/${customerId}/latest`,
      );
      return res.data;
    },
    enabled: Boolean(customerId),
    ...defaultQueryRetry,
    ...options,
  });
}

export function useGenerateRiskReport(
  scope: TenantScopeArg,
  options?: DefaultMutationOptions<RiskReport, { readonly customerId: string }>,
) {
  const qc = useQueryClient();
  return useMutation<RiskReport, ApiClientError, { readonly customerId: string }>({
    mutationFn: async ({ customerId }) => {
      const res = await client().post<RiskReport>(
        `${BASE}/${customerId}/generate`,
        {},
      );
      return res.data;
    },
    onSuccess: (data, variables, context) => {
      qc.invalidateQueries({
        queryKey: queryKeys.riskReports.latest(scope, variables.customerId),
      });
      options?.onSuccess?.(data, variables, undefined, context as never);
    },
    ...defaultMutationRetry,
    ...options,
  });
}
