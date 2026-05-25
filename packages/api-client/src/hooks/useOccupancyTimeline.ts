/**
 * Occupancy Timeline hooks.
 *
 * Endpoints:
 *   GET /occupancy-timeline/:id/occupancy-timeline?page=&limit=
 */

import { useQuery } from '@tanstack/react-query';
import type { ApiClientError } from '../client';
import { queryKeys } from './query-keys';
import {
  client,
  compact,
  defaultQueryRetry,
  type DefaultQueryOptions,
  type TenantScopeArg,
} from './shared';

export interface OccupancyTimelineEntry {
  readonly id: string;
  readonly unitId: string;
  readonly tenantId: string;
  readonly leaseId?: string;
  readonly occupiedFrom: string;
  readonly occupiedTo?: string;
  readonly customerId?: string;
  readonly monthlyRent?: number;
  readonly status: 'occupied' | 'vacant' | 'reserved';
}

export interface OccupancyTimelinePage {
  readonly items: ReadonlyArray<OccupancyTimelineEntry>;
  readonly page: number;
  readonly limit: number;
  readonly totalItems: number;
  readonly hasNextPage: boolean;
}

export interface OccupancyTimelineParams {
  readonly page?: number;
  readonly limit?: number;
}

const BASE = '/occupancy-timeline';

export function useUnitOccupancyTimeline(
  scope: TenantScopeArg,
  unitId: string,
  params?: OccupancyTimelineParams,
  options?: DefaultQueryOptions<OccupancyTimelinePage>,
) {
  return useQuery<OccupancyTimelinePage, ApiClientError>({
    queryKey: queryKeys.occupancyTimeline.forUnit(scope, unitId, params),
    queryFn: async () => {
      const res = await client().get<OccupancyTimelinePage>(
        `${BASE}/${unitId}/occupancy-timeline`,
        { params: compact(params as Record<string, unknown> | undefined) as Record<string, string | number | boolean> },
      );
      return res.data;
    },
    enabled: Boolean(unitId),
    ...defaultQueryRetry,
    ...options,
  });
}
