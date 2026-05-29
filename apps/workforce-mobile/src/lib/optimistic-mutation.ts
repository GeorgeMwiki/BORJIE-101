/**
 * RT-2 — Optimistic mutation helper for workforce-mobile.
 *
 * Mirror of `apps/owner-web/src/lib/optimistic-mutation.ts` — same
 * TanStack Query v5 onMutate / onError / onSettled pattern, no
 * platform-specific differences (TanStack ships isomorphic).
 *
 * See `Docs/RESEARCH/REALTIME_SOTA_2026-05-29.md` for the rationale.
 */

import type { QueryClient, QueryKey, UseMutationOptions } from '@tanstack/react-query';

export interface OptimisticMutationConfig<TData, TVariables> {
  readonly queryClient: QueryClient;
  readonly queryKey: QueryKey;
  readonly mutationFn: (variables: TVariables) => Promise<TData>;
  readonly applyOptimistic: (
    previous: TData | undefined,
    variables: TVariables,
  ) => TData | undefined;
  readonly relatedKeys?: ReadonlyArray<QueryKey>;
}

interface MutationContext<TData> {
  readonly previous: TData | undefined;
  readonly previousRelated: ReadonlyArray<{
    readonly key: QueryKey;
    readonly data: unknown;
  }>;
}

export function buildOptimisticMutation<TData, TVariables>(
  config: OptimisticMutationConfig<TData, TVariables>,
): UseMutationOptions<TData, Error, TVariables, MutationContext<TData>> {
  const { queryClient, queryKey, mutationFn, applyOptimistic, relatedKeys } =
    config;
  const cancelKeys = [queryKey, ...(relatedKeys ?? [])];

  return {
    mutationFn,
    onMutate: async (variables) => {
      await Promise.all(
        cancelKeys.map((k) => queryClient.cancelQueries({ queryKey: k })),
      );
      const previous = queryClient.getQueryData<TData>(queryKey);
      const previousRelated = (relatedKeys ?? []).map((key) => ({
        key,
        data: queryClient.getQueryData(key),
      }));
      const next = applyOptimistic(previous, variables);
      if (next !== undefined) {
        queryClient.setQueryData(queryKey, next);
      }
      return { previous, previousRelated };
    },
    onError: (_err, _variables, context) => {
      if (!context) return;
      queryClient.setQueryData(queryKey, context.previous);
      for (const r of context.previousRelated) {
        queryClient.setQueryData(r.key, r.data);
      }
    },
    onSettled: () => {
      for (const key of cancelKeys) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
    },
  };
}
