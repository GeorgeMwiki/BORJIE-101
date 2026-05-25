/**
 * Waitlist hooks.
 *
 * Endpoints:
 *   POST /waitlist/units/:unitId/join
 *   POST /waitlist/:id/leave
 *   GET  /waitlist/units/:unitId
 *   GET  /waitlist/customers/:customerId
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

export type WaitlistChannel = 'sms' | 'whatsapp' | 'email' | 'push' | 'in_app';
export type WaitlistSource =
  | 'enquiry'
  | 'failed_application'
  | 'manual_add'
  | 'marketplace_save'
  | 'ai_recommended';

export interface WaitlistEntry {
  readonly id: string;
  readonly tenantId: string;
  readonly unitId: string;
  readonly customerId: string;
  readonly priority: number;
  readonly source: WaitlistSource;
  readonly preferredChannels: ReadonlyArray<WaitlistChannel>;
  readonly status: 'active' | 'left' | 'matched' | 'expired';
  readonly joinedAt: string;
  readonly expiresAt?: string;
}

export interface JoinWaitlistInput {
  readonly unitId: string;
  readonly customerId: string;
  readonly listingId?: string;
  readonly priority?: number;
  readonly source?: WaitlistSource;
  readonly preferredChannels?: ReadonlyArray<WaitlistChannel>;
  readonly notificationPreferenceId?: string;
  readonly expiresAt?: string;
}

export interface LeaveWaitlistInput {
  readonly id: string;
  readonly reason?: string;
}

const BASE = '/waitlist';

export function useWaitlistForUnit(
  scope: TenantScopeArg,
  unitId: string,
  options?: DefaultQueryOptions<ReadonlyArray<WaitlistEntry>>,
) {
  return useQuery<ReadonlyArray<WaitlistEntry>, ApiClientError>({
    queryKey: queryKeys.waitlist.forUnit(scope, unitId),
    queryFn: async () => {
      const res = await client().get<ReadonlyArray<WaitlistEntry>>(
        `${BASE}/units/${unitId}`,
      );
      return res.data;
    },
    enabled: Boolean(unitId),
    ...defaultQueryRetry,
    ...options,
  });
}

export function useWaitlistForCustomer(
  scope: TenantScopeArg,
  customerId: string,
  options?: DefaultQueryOptions<ReadonlyArray<WaitlistEntry>>,
) {
  return useQuery<ReadonlyArray<WaitlistEntry>, ApiClientError>({
    queryKey: queryKeys.waitlist.forCustomer(scope, customerId),
    queryFn: async () => {
      const res = await client().get<ReadonlyArray<WaitlistEntry>>(
        `${BASE}/customers/${customerId}`,
      );
      return res.data;
    },
    enabled: Boolean(customerId),
    ...defaultQueryRetry,
    ...options,
  });
}

export function useJoinWaitlist(
  scope: TenantScopeArg,
  options?: DefaultMutationOptions<WaitlistEntry, JoinWaitlistInput>,
) {
  const qc = useQueryClient();
  return useMutation<WaitlistEntry, ApiClientError, JoinWaitlistInput>({
    mutationFn: async ({ unitId, ...body }) => {
      const res = await client().post<WaitlistEntry>(
        `${BASE}/units/${unitId}/join`,
        body,
      );
      return res.data;
    },
    onSuccess: (data, variables, context) => {
      qc.invalidateQueries({
        queryKey: queryKeys.waitlist.forUnit(scope, variables.unitId),
      });
      qc.invalidateQueries({
        queryKey: queryKeys.waitlist.forCustomer(scope, variables.customerId),
      });
      options?.onSuccess?.(data, variables, undefined, context as never);
    },
    ...defaultMutationRetry,
    ...options,
  });
}

export function useLeaveWaitlist(
  scope: TenantScopeArg,
  options?: DefaultMutationOptions<WaitlistEntry, LeaveWaitlistInput>,
) {
  const qc = useQueryClient();
  return useMutation<WaitlistEntry, ApiClientError, LeaveWaitlistInput>({
    mutationFn: async ({ id, reason }) => {
      const res = await client().post<WaitlistEntry>(`${BASE}/${id}/leave`, {
        reason,
      });
      return res.data;
    },
    onSuccess: (data, variables, context) => {
      qc.invalidateQueries({ queryKey: queryKeys.waitlist.all(scope) });
      options?.onSuccess?.(data, variables, undefined, context as never);
    },
    ...defaultMutationRetry,
    ...options,
  });
}
