/**
 * Applications hooks.
 *
 * Endpoints:
 *   POST /applications/route       → route an application to a station master
 *   POST /applications             → submit a new application
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ApiClientError } from '../client';
import { queryKeys } from './query-keys';
import {
  client,
  defaultMutationRetry,
  type DefaultMutationOptions,
  type TenantScopeArg,
} from './shared';

export type ApplicationAssetType =
  | 'residential'
  | 'commercial'
  | 'land'
  | 'mixed_use';

export interface ApplicationLocation {
  readonly city?: string;
  readonly country?: string;
  readonly regionId?: string;
  readonly propertyId?: string;
  readonly latitude?: number;
  readonly longitude?: number;
  readonly tags?: ReadonlyArray<string>;
}

export interface RouteApplicationInput {
  readonly applicationId: string;
  readonly assetType: ApplicationAssetType;
  readonly location: ApplicationLocation;
}

export interface RouteApplicationResult {
  readonly stationMasterId: string;
  readonly matchedCoverageKind?: string;
  readonly score: number;
}

export interface SubmitApplicationInput {
  readonly assetType: ApplicationAssetType;
  readonly location: ApplicationLocation;
  readonly customerId: string;
  readonly notes?: string;
  readonly payload?: Record<string, unknown>;
}

export interface Application {
  readonly id: string;
  readonly tenantId: string;
  readonly customerId: string;
  readonly assetType: ApplicationAssetType;
  readonly stationMasterId?: string;
  readonly status: 'submitted' | 'routed' | 'approved' | 'rejected';
  readonly submittedAt: string;
}

const BASE = '/applications';

export function useRouteApplication(
  scope: TenantScopeArg,
  options?: DefaultMutationOptions<RouteApplicationResult, RouteApplicationInput>,
) {
  const qc = useQueryClient();
  return useMutation<RouteApplicationResult, ApiClientError, RouteApplicationInput>({
    mutationFn: async (input) => {
      const res = await client().post<RouteApplicationResult>(
        `${BASE}/route`,
        input,
      );
      return res.data;
    },
    onSuccess: (data, variables, context) => {
      qc.invalidateQueries({
        queryKey: queryKeys.applications.detail(scope, variables.applicationId),
      });
      options?.onSuccess?.(data, variables, undefined, context as never);
    },
    ...defaultMutationRetry,
    ...options,
  });
}

export function useSubmitApplication(
  scope: TenantScopeArg,
  options?: DefaultMutationOptions<Application, SubmitApplicationInput>,
) {
  const qc = useQueryClient();
  return useMutation<Application, ApiClientError, SubmitApplicationInput>({
    mutationFn: async (input) => {
      const res = await client().post<Application>(BASE, input);
      return res.data;
    },
    onSuccess: (data, variables, context) => {
      qc.invalidateQueries({ queryKey: queryKeys.applications.all(scope) });
      options?.onSuccess?.(data, variables, undefined, context as never);
    },
    ...defaultMutationRetry,
    ...options,
  });
}
