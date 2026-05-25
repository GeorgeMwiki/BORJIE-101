/**
 * Station Master Coverage hooks.
 *
 * Endpoints:
 *   GET /station-master-coverage/:id/coverage        → list (read-side)
 *   PUT /station-master-coverage/:id/coverage        → replace
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

export type CoverageKind = 'tag' | 'polygon' | 'city' | 'property_ids' | 'region';

export interface CoverageItem {
  readonly kind: CoverageKind;
  readonly value: Record<string, unknown>;
  readonly priority: number;
}

export interface StationMasterCoverage {
  readonly stationMasterId: string;
  readonly tenantId: string;
  readonly coverages: ReadonlyArray<CoverageItem>;
  readonly updatedAt: string;
  readonly updatedBy: string;
}

export interface PutCoverageInput {
  readonly stationMasterId: string;
  readonly coverages: ReadonlyArray<CoverageItem>;
}

const BASE = '/station-master-coverage';

export function useStationMasterCoverage(
  scope: TenantScopeArg,
  stationMasterId: string,
  options?: DefaultQueryOptions<StationMasterCoverage>,
) {
  return useQuery<StationMasterCoverage, ApiClientError>({
    queryKey: queryKeys.stationMasterCoverage.forStaff(scope, stationMasterId),
    queryFn: async () => {
      const res = await client().get<StationMasterCoverage>(
        `${BASE}/${stationMasterId}/coverage`,
      );
      return res.data;
    },
    enabled: Boolean(stationMasterId),
    ...defaultQueryRetry,
    ...options,
  });
}

export function usePutStationMasterCoverage(
  scope: TenantScopeArg,
  options?: DefaultMutationOptions<StationMasterCoverage, PutCoverageInput>,
) {
  const qc = useQueryClient();
  return useMutation<StationMasterCoverage, ApiClientError, PutCoverageInput>({
    mutationFn: async ({ stationMasterId, coverages }) => {
      const res = await client().put<StationMasterCoverage>(
        `${BASE}/${stationMasterId}/coverage`,
        { coverages },
      );
      return res.data;
    },
    onSuccess: (data, variables, context) => {
      qc.invalidateQueries({
        queryKey: queryKeys.stationMasterCoverage.forStaff(
          scope,
          variables.stationMasterId,
        ),
      });
      options?.onSuccess?.(data, variables, undefined, context as never);
    },
    ...defaultMutationRetry,
    ...options,
  });
}
