/**
 * Notification Preferences hooks.
 *
 * Endpoints:
 *   GET /me/notification-preferences
 *   PUT /me/notification-preferences
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

export interface NotificationChannelsV2 {
  readonly email?: boolean;
  readonly sms?: boolean;
  readonly push?: boolean;
  readonly whatsapp?: boolean;
}

export interface NotificationPreferencesV2 {
  readonly userId: string;
  readonly tenantId: string;
  readonly channels: NotificationChannelsV2;
  readonly templates: Record<string, boolean>;
  readonly quietHoursStart?: string;
  readonly quietHoursEnd?: string;
  readonly updatedAt: string;
}

export interface UpdateNotificationPreferencesV2Input {
  readonly channels?: NotificationChannelsV2;
  readonly templates?: Record<string, boolean>;
  readonly quietHoursStart?: string;
  readonly quietHoursEnd?: string;
}

const BASE = '/me/notification-preferences';

export function useNotificationPreferences(
  scope: TenantScopeArg,
  options?: DefaultQueryOptions<NotificationPreferencesV2>,
) {
  return useQuery<NotificationPreferencesV2, ApiClientError>({
    queryKey: queryKeys.notificationPreferences.current(scope),
    queryFn: async () => {
      const res = await client().get<NotificationPreferencesV2>(BASE);
      return res.data;
    },
    ...defaultQueryRetry,
    ...options,
  });
}

export function useUpdateNotificationPreferences(
  scope: TenantScopeArg,
  options?: DefaultMutationOptions<
    NotificationPreferencesV2,
    UpdateNotificationPreferencesV2Input
  >,
) {
  const qc = useQueryClient();
  return useMutation<
    NotificationPreferencesV2,
    ApiClientError,
    UpdateNotificationPreferencesV2Input
  >({
    mutationFn: async (input) => {
      const res = await client().put<NotificationPreferencesV2>(BASE, input);
      return res.data;
    },
    onSuccess: (data, variables, context) => {
      qc.invalidateQueries({ queryKey: queryKeys.notificationPreferences.all(scope) });
      options?.onSuccess?.(data, variables, undefined, context as never);
    },
    ...defaultMutationRetry,
    ...options,
  });
}
