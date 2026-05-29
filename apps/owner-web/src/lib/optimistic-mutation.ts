/**
 * RT-2 — Optimistic mutation helper for owner-web (TanStack Query v5).
 *
 * Implements the canonical 3-step optimistic update pattern from
 * `Docs/research/REALTIME_SOTA_2026-05-29.md` §4:
 *
 *   1. onMutate: cancel in-flight queries → snapshot previous cache
 *      → apply optimistic update.
 *   2. onError: rollback to the snapshot if the server rejects.
 *   3. onSettled: invalidate so the next refetch picks up the
 *      authoritative server state (handles both success + rollback
 *      cases uniformly).
 *
 * Pair with the cockpit SSE consumer: when the corresponding event
 * arrives the cache is already correct, so the reconcile is a no-op
 * — perceived latency = browser repaint (~5 ms).
 *
 * Usage:
 *
 *   const mutation = useMutation(
 *     buildOptimisticMutation<TaskRow, AssignBody>({
 *       queryClient,
 *       queryKey: ['tasks', 'mine'],
 *       mutationFn: (body) => assignTaskApi(body),
 *       applyOptimistic: (prev, body) =>
 *         prev.map((t) => (t.id === body.taskId
 *           ? { ...t, assigneeId: body.assigneeId }
 *           : t)),
 *     }),
 *   );
 */

import type { QueryClient, QueryKey, UseMutationOptions } from '@tanstack/react-query';

export interface OptimisticMutationConfig<TData, TVariables> {
  readonly queryClient: QueryClient;
  readonly queryKey: QueryKey;
  readonly mutationFn: (variables: TVariables) => Promise<TData>;
  /**
   * Pure transform from the current cache snapshot + the mutation
   * variables to the optimistic next-state. Returns the next value
   * (immutably — never mutate the input). If the cache key has no
   * data yet (undefined) the transform may return undefined and the
   * rollback path is a no-op.
   */
  readonly applyOptimistic: (
    previous: TData | undefined,
    variables: TVariables,
  ) => TData | undefined;
  /**
   * Optional secondary query keys to also cancel + invalidate. Useful
   * when the mutation updates two views (e.g. mine + by-status).
   */
  readonly relatedKeys?: ReadonlyArray<QueryKey>;
}

interface MutationContext<TData> {
  readonly previous: TData | undefined;
  readonly previousRelated: ReadonlyArray<{
    readonly key: QueryKey;
    readonly data: unknown;
  }>;
}

/**
 * Build the `UseMutationOptions` to pass to `useMutation` for an
 * optimistic-update flow. Returns the full options object so callers
 * can spread their own `onSuccess` etc. on top.
 */
export function buildOptimisticMutation<TData, TVariables>(
  config: OptimisticMutationConfig<TData, TVariables>,
): UseMutationOptions<TData, Error, TVariables, MutationContext<TData>> {
  const { queryClient, queryKey, mutationFn, applyOptimistic, relatedKeys } =
    config;
  const cancelKeys = [queryKey, ...(relatedKeys ?? [])];

  return {
    mutationFn,
    onMutate: async (variables) => {
      // 1. Cancel any in-flight refetches so they cannot overwrite
      //    our optimistic update mid-flight.
      await Promise.all(
        cancelKeys.map((k) => queryClient.cancelQueries({ queryKey: k })),
      );

      // 2. Snapshot the current cache for every key we will mutate.
      const previous = queryClient.getQueryData<TData>(queryKey);
      const previousRelated = (relatedKeys ?? []).map((key) => ({
        key,
        data: queryClient.getQueryData(key),
      }));

      // 3. Apply the optimistic update.
      const next = applyOptimistic(previous, variables);
      if (next !== undefined) {
        queryClient.setQueryData(queryKey, next);
      }

      return { previous, previousRelated };
    },
    onError: (_err, _variables, context) => {
      if (!context) return;
      // Rollback the primary key + every related key.
      queryClient.setQueryData(queryKey, context.previous);
      for (const r of context.previousRelated) {
        queryClient.setQueryData(r.key, r.data);
      }
    },
    onSettled: () => {
      // Invalidate so the next refetch picks up the server-authored
      // truth — runs after both success and rollback paths so the
      // cache cannot drift from the server state.
      for (const key of cancelKeys) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
    },
  };
}
