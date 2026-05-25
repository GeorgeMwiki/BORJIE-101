/**
 * Interactive Reports hooks.
 *
 * Endpoints:
 *   GET  /interactive-reports/:id/interactive
 *   POST /interactive-reports/:id/action-plans/:aid/ack
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

export interface InteractiveReportVersion {
  readonly id: string;
  readonly reportInstanceId: string;
  readonly version: number;
  readonly generatedAt: string;
  readonly sections: ReadonlyArray<Record<string, unknown>>;
  readonly actionPlans: ReadonlyArray<{
    readonly id: string;
    readonly title: string;
    readonly actionKind:
      | 'create_work_order'
      | 'create_approval_request'
      | 'acknowledge'
      | 'external_link';
    readonly completedAt?: string;
  }>;
}

export interface AckActionPlanInput {
  readonly reportVersionId: string;
  readonly actionPlanId: string;
  readonly actionKind?:
    | 'create_work_order'
    | 'create_approval_request'
    | 'acknowledge'
    | 'external_link';
  readonly metadata?: Record<string, unknown>;
}

export interface AckActionPlanResult {
  readonly actionPlanId: string;
  readonly completedAt: string;
  readonly spawnedEntityId?: string;
}

const BASE = '/interactive-reports';

export function useInteractiveReport(
  scope: TenantScopeArg,
  reportId: string,
  options?: DefaultQueryOptions<InteractiveReportVersion>,
) {
  return useQuery<InteractiveReportVersion, ApiClientError>({
    queryKey: queryKeys.interactiveReports.latest(scope, reportId),
    queryFn: async () => {
      const res = await client().get<InteractiveReportVersion>(
        `${BASE}/${reportId}/interactive`,
      );
      return res.data;
    },
    enabled: Boolean(reportId),
    ...defaultQueryRetry,
    ...options,
  });
}

export function useAckActionPlan(
  scope: TenantScopeArg,
  options?: DefaultMutationOptions<AckActionPlanResult, AckActionPlanInput>,
) {
  const qc = useQueryClient();
  return useMutation<AckActionPlanResult, ApiClientError, AckActionPlanInput>({
    mutationFn: async ({ reportVersionId, actionPlanId, actionKind, metadata }) => {
      const res = await client().post<AckActionPlanResult>(
        `${BASE}/${reportVersionId}/action-plans/${actionPlanId}/ack`,
        { actionKind, metadata },
      );
      return res.data;
    },
    onSuccess: (data, variables, context) => {
      qc.invalidateQueries({
        queryKey: queryKeys.interactiveReports.all(scope),
      });
      options?.onSuccess?.(data, variables, undefined, context as never);
    },
    ...defaultMutationRetry,
    ...options,
  });
}
