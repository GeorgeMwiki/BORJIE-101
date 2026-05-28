'use client';

/**
 * useRecentlySpawnedTabTypes — pulls the owner's recently-spawned tab
 * types so the "+ Tab" dropdown can show ONLY those by default (instead
 * of dumping the full 14-tab registry).
 *
 * Wave OWNER-OS-DYNAMIC Phase 2.
 *
 * Hits `GET /api/v1/owner/tabs/recent-types?days=N`. The server derives
 * the list from the owner's `owner_tabs.state.tabs[]` jsonb (each entry's
 * `lastOpenedAt`), so the result is a small ordered set of types like
 * `["compliance","hr","finance"]` ordered most-recent first.
 *
 * The hook is intentionally light — no react-query, no SWR. The "+ Tab"
 * menu opens infrequently; a one-shot fetch on the first open is fine.
 * Re-opens within the same session reuse the in-memory cache; sign-in
 * resets it.
 *
 * The BRAIN AWARENESS IS UNAFFECTED by this filter — the system prompt
 * extension reminds the model that all 14 tab types exist and it can
 * suggest any of them based on the conversation. This hook is purely a
 * FE affordance trim.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { apiRequest } from '@/lib/api-client';

export interface RecentTabType {
  readonly type: string;
  /** ISO 8601 — null when the tab predates the lastOpenedAt tracking field. */
  readonly lastOpenedAt: string | null;
}

export interface UseRecentlySpawnedTabTypesResult {
  /** Recently-spawned types, most-recent first. Empty when no row exists. */
  readonly types: ReadonlyArray<RecentTabType>;
  /** True until the first fetch resolves. */
  readonly loading: boolean;
  /** Error code from the BFF if any. Null when no error. */
  readonly error: string | null;
  /** Force a refresh (e.g. after a spawn). */
  refresh(): Promise<void>;
}

interface RecentTypesResponse {
  readonly types: ReadonlyArray<RecentTabType>;
  readonly windowDays: number;
  readonly derivedAt: string;
}

// Module-scoped cache keyed by `days`. Survives component remounts so
// re-opening the dropdown is instant — but is wiped on sign-out (the
// next mount re-fetches with a fresh JWT).
const cache = new Map<number, RecentTypesResponse>();

export function useRecentlySpawnedTabTypes(
  days = 30,
): UseRecentlySpawnedTabTypesResult {
  const cached = cache.get(days);
  const [types, setTypes] = useState<ReadonlyArray<RecentTabType>>(
    cached?.types ?? [],
  );
  const [loading, setLoading] = useState<boolean>(!cached);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  const fetchTypes = useCallback(async (): Promise<void> => {
    try {
      setLoading(true);
      setError(null);
      const res = await apiRequest<RecentTypesResponse>(
        `/api/v1/owner/tabs/recent-types?days=${encodeURIComponent(String(days))}`,
        { method: 'GET' },
      );
      cache.set(days, res);
      if (mounted.current) {
        setTypes(res.types ?? []);
        setLoading(false);
      }
    } catch (err) {
      if (!mounted.current) return;
      setLoading(false);
      setError(err instanceof Error ? err.message : 'recent-types fetch failed');
    }
  }, [days]);

  useEffect(() => {
    mounted.current = true;
    if (!cached) {
      void fetchTypes();
    }
    return () => {
      mounted.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days]);

  return {
    types,
    loading,
    error,
    refresh: fetchTypes,
  };
}

/** Test helper — wipe the in-memory cache between cases. */
export function __resetRecentlySpawnedTabTypesCacheForTests(): void {
  cache.clear();
}
