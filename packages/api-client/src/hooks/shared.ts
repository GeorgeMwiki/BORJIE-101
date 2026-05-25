/**
 * Shared helpers for the Wave 2 React Query hooks.
 *
 * Every hook in this folder relies on `@tanstack/react-query` and
 * delegates transport to the BORJIE `ApiClient` singleton. Keeping
 * the glue in one place means each resource hook stays small and
 * focused on its specific endpoint shape.
 */

import type { UseQueryOptions, UseMutationOptions } from '@tanstack/react-query';
import { getApiClient, type ApiClientError } from '../client';

/**
 * Common query options applied to every useQuery call in this folder.
 * Apps can still override per-call by spreading `queryOverrides`.
 */
export type DefaultQueryOptions<TData> = Omit<
  UseQueryOptions<TData, ApiClientError, TData, readonly unknown[]>,
  'queryKey' | 'queryFn'
>;

export type DefaultMutationOptions<TData, TVariables> = Omit<
  UseMutationOptions<TData, ApiClientError, TVariables>,
  'mutationFn'
>;

/**
 * Tenant / org scope required by every key factory.
 */
export interface TenantScopeArg {
  readonly tenantId: string;
  readonly orgId?: string;
}

/**
 * Standard query defaults: retry once, propagate afterwards.
 * Matches the "retry once, then propagate" rule for the Wave 2 hooks.
 */
export const defaultQueryRetry = {
  retry: 1 as const,
};

/**
 * Standard mutation defaults: retry once, propagate afterwards.
 */
export const defaultMutationRetry = {
  retry: 1 as const,
};

/**
 * Resolve the configured ApiClient. Wrapped so tests can mock it.
 */
export function client() {
  return getApiClient();
}

/**
 * Strip `undefined` values from a filter object so they don't end up
 * as `?key=undefined` in the query string.
 */
export function compact<T extends Record<string, unknown>>(
  obj: T | undefined,
): Partial<T> {
  if (!obj) return {};
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined && v !== null) {
      (out as Record<string, unknown>)[k] = v;
    }
  }
  return out;
}
