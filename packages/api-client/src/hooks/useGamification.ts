/**
 * Gamification hooks.
 *
 * Endpoints:
 *   GET  /gamification/policies
 *   PUT  /gamification/policies
 *   GET  /gamification/customers/:customerId
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

export interface GamificationPolicy {
  readonly id: string;
  readonly tenantId: string;
  readonly onTimePoints: number;
  readonly earlyPaymentBonusPoints: number;
  readonly latePenaltyPoints: number;
  readonly streakBonusPoints: number;
  readonly bronzeThreshold: number;
  readonly silverThreshold: number;
  readonly goldThreshold: number;
  readonly platinumThreshold: number;
  readonly earlyPayDiscountBps: number;
  readonly earlyPayMinDaysBefore: number;
  readonly earlyPayMaxCreditMinor: number;
  readonly lateFeeBps: number;
  readonly lateFeeGraceDays: number;
  readonly lateFeeMaxMinor: number;
  readonly cashbackEnabled: boolean;
  readonly cashbackBps: number;
  readonly cashbackMonthlyCapMinor: number;
  readonly cashbackProvider?: 'mpesa_b2c' | 'airtel_b2c' | 'tigopesa_b2c';
  readonly active: boolean;
}

export type UpdateGamificationPolicyInput = Partial<
  Omit<GamificationPolicy, 'id' | 'tenantId' | 'active'>
>;

export interface GamificationCustomerState {
  readonly customerId: string;
  readonly tenantId: string;
  readonly totalPoints: number;
  readonly tier: 'none' | 'bronze' | 'silver' | 'gold' | 'platinum';
  readonly streakMonths: number;
  readonly cashbackAccruedMinor: number;
}

const BASE = '/gamification';

export function useGamificationPolicy(
  scope: TenantScopeArg,
  options?: DefaultQueryOptions<GamificationPolicy>,
) {
  return useQuery<GamificationPolicy, ApiClientError>({
    queryKey: queryKeys.gamification.policy(scope),
    queryFn: async () => {
      const res = await client().get<GamificationPolicy>(`${BASE}/policies`);
      return res.data;
    },
    ...defaultQueryRetry,
    ...options,
  });
}

export function useUpdateGamificationPolicy(
  scope: TenantScopeArg,
  options?: DefaultMutationOptions<GamificationPolicy, UpdateGamificationPolicyInput>,
) {
  const qc = useQueryClient();
  return useMutation<GamificationPolicy, ApiClientError, UpdateGamificationPolicyInput>({
    mutationFn: async (patch) => {
      const res = await client().put<GamificationPolicy>(`${BASE}/policies`, patch);
      return res.data;
    },
    onSuccess: (data, variables, context) => {
      qc.invalidateQueries({ queryKey: queryKeys.gamification.all(scope) });
      options?.onSuccess?.(data, variables, undefined, context as never);
    },
    ...defaultMutationRetry,
    ...options,
  });
}

export function useGamificationCustomer(
  scope: TenantScopeArg,
  customerId: string,
  options?: DefaultQueryOptions<GamificationCustomerState>,
) {
  return useQuery<GamificationCustomerState, ApiClientError>({
    queryKey: queryKeys.gamification.customer(scope, customerId),
    queryFn: async () => {
      const res = await client().get<GamificationCustomerState>(
        `${BASE}/customers/${customerId}`,
      );
      return res.data;
    },
    enabled: Boolean(customerId),
    ...defaultQueryRetry,
    ...options,
  });
}
