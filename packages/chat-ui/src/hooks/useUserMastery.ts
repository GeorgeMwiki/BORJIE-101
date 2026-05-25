/**
 * useUserMastery — React hook that exposes the current user's mastery
 * level and the next-threshold to React components.
 *
 * Lifecycle:
 *   1. mount → state.status = 'loading', score = null
 *   2. store.read resolves → status = 'ready', score populated
 *   3. store.read rejects → status = 'error', error captured
 *
 * Until step (2) the hook returns `score: null` — components MUST
 * treat that as "do not render mastery-gated chrome yet". This avoids
 * the flash-of-novice-UI on first paint for power users.
 *
 * The hook is intentionally NOT a context provider. Each consumer
 * supplies its own store + identity so tests can mount the hook in
 * isolation. Apps that want a single shared score should wrap a
 * context provider around `loadMasteryScore` themselves.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  MasteryScore,
  UserActionStore,
  UserActionEvent,
} from '../lib/user-mastery/index.js';
import {
  computeMasteryScore,
  recordUserAction,
} from '../lib/user-mastery/index.js';

export interface UseUserMasteryOptions {
  readonly tenantId: string;
  readonly userId: string;
  readonly store: UserActionStore;
  /** Pin "now" for deterministic tests / SSR snapshots. */
  readonly now?: number;
  /**
   * Disable network reads (e.g. when a parent has already prefetched
   * the records). Defaults to `false`.
   */
  readonly skip?: boolean;
}

export type UseUserMasteryStatus = 'loading' | 'ready' | 'error';

export interface UseUserMasteryResult {
  readonly status: UseUserMasteryStatus;
  readonly score: MasteryScore | null;
  readonly error: Error | null;
  /** Manually re-fetch (e.g. after a known action that should bump tier). */
  readonly refresh: () => Promise<void>;
  /**
   * Record an action AND refresh the local score so the UI reflects
   * the new tier on the next render. Safe to call from event handlers.
   */
  readonly record: (
    actionId: string,
    extra?: Partial<UserActionEvent>,
  ) => Promise<void>;
}

export function useUserMastery(
  options: UseUserMasteryOptions,
): UseUserMasteryResult {
  const { tenantId, userId, store, now, skip = false } = options;
  const [status, setStatus] = useState<UseUserMasteryStatus>(
    skip ? 'ready' : 'loading',
  );
  const [score, setScore] = useState<MasteryScore | null>(null);
  const [error, setError] = useState<Error | null>(null);

  // Capture mount state so a slow read that resolves after unmount
  // does not trigger a setState warning.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    if (skip) return;
    setStatus('loading');
    setError(null);
    try {
      const records = await store.read(tenantId, userId);
      if (!mountedRef.current) return;
      const computed = computeMasteryScore(
        records,
        now !== undefined ? { now } : {},
      );
      setScore(computed);
      setStatus('ready');
    } catch (err) {
      if (!mountedRef.current) return;
      const wrapped = err instanceof Error ? err : new Error(String(err));
      setError(wrapped);
      setStatus('error');
    }
  }, [skip, store, tenantId, userId, now]);

  useEffect(() => {
    if (skip) {
      setStatus('ready');
      return;
    }
    void refresh();
  }, [refresh, skip]);

  const record = useCallback(
    async (actionId: string, extra: Partial<UserActionEvent> = {}) => {
      const event: UserActionEvent = {
        tenantId,
        userId,
        actionId,
        ...extra,
      };
      await recordUserAction(store, event);
      await refresh();
    },
    [store, tenantId, userId, refresh],
  );

  return { status, score, error, refresh, record };
}
