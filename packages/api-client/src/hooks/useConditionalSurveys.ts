/**
 * Conditional Surveys hooks.
 *
 * The gateway router is still landing (`conditional-survey-repository`
 * in domain-services is the source of truth). We hit the canonical
 * REST shape so the UI is ready the moment the router ships.
 *
 * Endpoints:
 *   GET  /conditional-surveys                      → list
 *   POST /conditional-surveys                      → schedule
 *   GET  /conditional-surveys/:id                  → detail
 *   POST /conditional-surveys/:id/compile          → compile results
 *   POST /conditional-surveys/:id/actions/:actionId/approve
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

export type ConditionalSurveyStatus =
  | 'scheduled'
  | 'in_progress'
  | 'compiled'
  | 'approved'
  | 'cancelled';

export interface ConditionalSurveyAction {
  readonly id: string;
  readonly kind: 'work_order' | 'reinspection' | 'case' | 'letter';
  readonly status: 'pending' | 'approved' | 'completed' | 'dismissed';
  readonly details: Record<string, unknown>;
}

export interface ConditionalSurvey {
  readonly id: string;
  readonly tenantId: string;
  readonly propertyId?: string;
  readonly unitId?: string;
  readonly templateId: string;
  readonly scheduledFor: string;
  readonly conductedAt?: string;
  readonly conductedBy?: string;
  readonly status: ConditionalSurveyStatus;
  readonly actions: ReadonlyArray<ConditionalSurveyAction>;
}

export interface ConditionalSurveyFilters {
  readonly status?: ConditionalSurveyStatus;
  readonly propertyId?: string;
  readonly unitId?: string;
  readonly limit?: number;
  readonly offset?: number;
}

export interface ScheduleConditionalSurveyInput {
  readonly templateId: string;
  readonly scheduledFor: string;
  readonly propertyId?: string;
  readonly unitId?: string;
  readonly notes?: string;
}

export interface CompileConditionalSurveyInput {
  readonly id: string;
  readonly findings: ReadonlyArray<Record<string, unknown>>;
}

export interface ApproveSurveyActionInput {
  readonly surveyId: string;
  readonly actionId: string;
  readonly approvalNotes?: string;
}

const BASE = '/conditional-surveys';

export function useConditionalSurveys(
  scope: TenantScopeArg,
  filters?: ConditionalSurveyFilters,
  options?: DefaultQueryOptions<ReadonlyArray<ConditionalSurvey>>,
) {
  return useQuery<ReadonlyArray<ConditionalSurvey>, ApiClientError>({
    queryKey: queryKeys.conditionalSurveys.list(
      scope,
      filters as Record<string, unknown> | undefined,
    ),
    queryFn: async () => {
      const res = await client().get<ReadonlyArray<ConditionalSurvey>>(BASE, {
        params: compact(filters as Record<string, unknown>) as Record<string, string | number | boolean>,
      });
      return res.data;
    },
    ...defaultQueryRetry,
    ...options,
  });
}

export function useConditionalSurvey(
  scope: TenantScopeArg,
  id: string,
  options?: DefaultQueryOptions<ConditionalSurvey>,
) {
  return useQuery<ConditionalSurvey, ApiClientError>({
    queryKey: queryKeys.conditionalSurveys.detail(scope, id),
    queryFn: async () => {
      const res = await client().get<ConditionalSurvey>(`${BASE}/${id}`);
      return res.data;
    },
    enabled: Boolean(id),
    ...defaultQueryRetry,
    ...options,
  });
}

export function useScheduleConditionalSurvey(
  scope: TenantScopeArg,
  options?: DefaultMutationOptions<ConditionalSurvey, ScheduleConditionalSurveyInput>,
) {
  const qc = useQueryClient();
  return useMutation<ConditionalSurvey, ApiClientError, ScheduleConditionalSurveyInput>({
    mutationFn: async (input) => {
      const res = await client().post<ConditionalSurvey>(BASE, input);
      return res.data;
    },
    onSuccess: (data, variables, context) => {
      qc.invalidateQueries({ queryKey: queryKeys.conditionalSurveys.all(scope) });
      options?.onSuccess?.(data, variables, undefined, context as never);
    },
    ...defaultMutationRetry,
    ...options,
  });
}

export function useCompileConditionalSurvey(
  scope: TenantScopeArg,
  options?: DefaultMutationOptions<ConditionalSurvey, CompileConditionalSurveyInput>,
) {
  const qc = useQueryClient();
  return useMutation<ConditionalSurvey, ApiClientError, CompileConditionalSurveyInput>({
    mutationFn: async ({ id, findings }) => {
      const res = await client().post<ConditionalSurvey>(`${BASE}/${id}/compile`, {
        findings,
      });
      return res.data;
    },
    onSuccess: (data, variables, context) => {
      qc.invalidateQueries({
        queryKey: queryKeys.conditionalSurveys.detail(scope, variables.id),
      });
      options?.onSuccess?.(data, variables, undefined, context as never);
    },
    ...defaultMutationRetry,
    ...options,
  });
}

export function useApproveSurveyAction(
  scope: TenantScopeArg,
  options?: DefaultMutationOptions<ConditionalSurveyAction, ApproveSurveyActionInput>,
) {
  const qc = useQueryClient();
  return useMutation<ConditionalSurveyAction, ApiClientError, ApproveSurveyActionInput>({
    mutationFn: async ({ surveyId, actionId, approvalNotes }) => {
      const res = await client().post<ConditionalSurveyAction>(
        `${BASE}/${surveyId}/actions/${actionId}/approve`,
        { approvalNotes },
      );
      return res.data;
    },
    onSuccess: (data, variables, context) => {
      qc.invalidateQueries({
        queryKey: queryKeys.conditionalSurveys.detail(scope, variables.surveyId),
      });
      options?.onSuccess?.(data, variables, undefined, context as never);
    },
    ...defaultMutationRetry,
    ...options,
  });
}
