/**
 * useLearnedShortcuts — React hook bridging the UI-3 owned
 * `user_action_tracker` Supabase table to the chat-ui ranker + panel.
 *
 * The hook is deliberately decoupled from Supabase: callers inject a
 * `fetcher` so the hook can be unit-tested without a database and so
 * the same hook serves both the Next.js app router (RSC + RPC) and
 * the Vite owner-portal SPA.
 *
 * Lifecycle:
 *   1. Mount with (userId, route)            → kick off initial fetch
 *   2. Fetch resolves                        → cache rows + run ranker
 *   3. Route changes                         → re-fetch immediately
 *   4. 5min stale-while-revalidate elapses   → background refresh
 *   5. User pins / unpins                    → re-run ranker without
 *      re-fetching (purely client-side rearrangement)
 *
 * Mastery threshold:
 *   When the user has fewer than `masteryThreshold` distinct rows on
 *   the current route, `shortcuts` resolves to `null`. The panel
 *   treats `null` as "hide entirely" — no empty-state UI.
 */

import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import { rankActions } from '../lib/learned-shortcuts/ranker.js';
import type {
  LearnedShortcut,
  PinnedStorage,
  ShortcutsCacheEntry,
  UseLearnedShortcutsOptions,
  UseLearnedShortcutsResult,
  UserActionTrackerRow,
} from '../lib/learned-shortcuts/types.js';

const DEFAULT_MASTERY_THRESHOLD = 3;
const DEFAULT_STALE_AFTER_MS = 5 * 60 * 1000;
const DEFAULT_TOP_N = 5;

interface State {
  readonly cache: ShortcutsCacheEntry | null;
  readonly pinnedIds: ReadonlyArray<string>;
  readonly isLoading: boolean;
  readonly error: Error | null;
  /** Bumped to force a re-fetch even if data is still fresh. */
  readonly refreshNonce: number;
}

type Action =
  | { readonly kind: 'fetch_start' }
  | {
      readonly kind: 'fetch_success';
      readonly entry: ShortcutsCacheEntry;
    }
  | { readonly kind: 'fetch_error'; readonly error: Error }
  | { readonly kind: 'set_pinned'; readonly ids: ReadonlyArray<string> }
  | { readonly kind: 'refresh' }
  | { readonly kind: 'route_changed' };

function reducer(state: State, action: Action): State {
  switch (action.kind) {
    case 'fetch_start':
      return { ...state, isLoading: true, error: null };
    case 'fetch_success':
      return {
        ...state,
        cache: action.entry,
        isLoading: false,
        error: null,
      };
    case 'fetch_error':
      return { ...state, isLoading: false, error: action.error };
    case 'set_pinned':
      return { ...state, pinnedIds: action.ids };
    case 'refresh':
      return { ...state, refreshNonce: state.refreshNonce + 1 };
    case 'route_changed':
      return {
        ...state,
        cache: null,
        isLoading: false,
        error: null,
      };
    default:
      return state;
  }
}

/**
 * Resolve a storage backend. Falls back to a no-op in environments
 * without `window` (SSR / Vitest jsdom without DOM polyfill). The
 * no-op storage keeps the hook safe to call during server render.
 */
function resolveStorage(override?: PinnedStorage): PinnedStorage {
  if (override) return override;
  if (typeof window !== 'undefined' && window.localStorage) {
    return window.localStorage;
  }
  return {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  };
}

function pinnedStorageKey(userId: string, route: string): string {
  return `learned-shortcuts:pinned:${userId}:${route}`;
}

// Hard caps on what we accept from localStorage. Pinning is a UX nicety
// — a single user has no reason to pin >50 shortcuts on one route, and
// each id should be a normal slug (< 256 chars). Bounded reads close the
// Wave-12 LOW finding: a malicious extension / dev-tools edit storing
// e.g. `JSON.stringify(["a".repeat(1e7), ...])` should NOT be loaded
// into React state at full size.
const MAX_PINNED_IDS = 50;
const MAX_PIN_ID_LENGTH = 256;

function readPinned(
  storage: PinnedStorage,
  userId: string,
  route: string,
): ReadonlyArray<string> {
  if (!userId || !route) return [];
  try {
    const raw = storage.getItem(pinnedStorageKey(userId, route));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (v): v is string =>
          typeof v === 'string' && v.length > 0 && v.length <= MAX_PIN_ID_LENGTH,
      )
      .slice(0, MAX_PINNED_IDS);
  } catch {
    return [];
  }
}

function writePinned(
  storage: PinnedStorage,
  userId: string,
  route: string,
  ids: ReadonlyArray<string>,
): void {
  if (!userId || !route) return;
  // Defensive bound on write side too: if upstream callers ever push
  // more than MAX_PINNED_IDS we drop the overflow rather than
  // persisting it (next mount would silently truncate anyway).
  const bounded = ids
    .filter((id) => typeof id === 'string' && id.length > 0 && id.length <= MAX_PIN_ID_LENGTH)
    .slice(0, MAX_PINNED_IDS);
  try {
    storage.setItem(pinnedStorageKey(userId, route), JSON.stringify(bounded));
  } catch {
    // Swallow quota / serialization errors — pinning is a UX nicety,
    // not safety-critical. The next mount will simply lose the pins.
  }
}

export function useLearnedShortcuts(
  options: UseLearnedShortcutsOptions,
): UseLearnedShortcutsResult {
  const {
    userId,
    route,
    fetcher,
    masteryThreshold = DEFAULT_MASTERY_THRESHOLD,
    staleAfterMs = DEFAULT_STALE_AFTER_MS,
    topN = DEFAULT_TOP_N,
    storage: storageOverride,
  } = options;

  const storage = useMemo(
    () => resolveStorage(storageOverride),
    [storageOverride],
  );

  const initialPinned = useMemo(
    () => readPinned(storage, userId, route),
    [storage, userId, route],
  );

  const [state, dispatch] = useReducer(reducer, {
    cache: null,
    pinnedIds: initialPinned,
    isLoading: false,
    error: null,
    refreshNonce: 0,
  });

  // Track the latest route so an in-flight fetch from a previous route
  // cannot stomp the new route's cache after the user has navigated.
  const requestIdRef = useRef(0);

  // Re-load pins whenever route or user changes (separate from data
  // fetch so pin-only updates don't trigger a network round-trip).
  useEffect(() => {
    dispatch({ kind: 'route_changed' });
    dispatch({ kind: 'set_pinned', ids: readPinned(storage, userId, route) });
  }, [storage, userId, route]);

  // Primary fetch effect — fires on (userId, route, refreshNonce). The
  // stale-while-revalidate interval lives in a separate effect below.
  useEffect(() => {
    if (!userId || !route) return;
    const requestId = ++requestIdRef.current;
    let cancelled = false;
    dispatch({ kind: 'fetch_start' });

    fetcher({ userId, route })
      .then((rows) => {
        if (cancelled || requestId !== requestIdRef.current) return;
        dispatch({
          kind: 'fetch_success',
          entry: { fetchedAt: Date.now(), rows },
        });
      })
      .catch((err: unknown) => {
        if (cancelled || requestId !== requestIdRef.current) return;
        const error =
          err instanceof Error ? err : new Error('Failed to load shortcuts');
        dispatch({ kind: 'fetch_error', error });
      });

    return () => {
      cancelled = true;
    };
  }, [userId, route, fetcher, state.refreshNonce]);

  // Stale-while-revalidate — when the cache ages past `staleAfterMs`,
  // bump the refreshNonce in the background so a new fetch fires.
  useEffect(() => {
    if (!state.cache) return undefined;
    if (staleAfterMs <= 0) return undefined;
    const age = Date.now() - state.cache.fetchedAt;
    const remaining = Math.max(0, staleAfterMs - age);
    const handle = setTimeout(() => {
      dispatch({ kind: 'refresh' });
    }, remaining);
    return () => clearTimeout(handle);
  }, [state.cache, staleAfterMs]);

  const pin = useCallback(
    (id: string) => {
      // Drag-to-pin moves the action to the front; existing pins are
      // preserved after the new one. If it was already pinned, it
      // gets bumped to the top.
      const next = [id, ...state.pinnedIds.filter((p) => p !== id)];
      writePinned(storage, userId, route, next);
      dispatch({ kind: 'set_pinned', ids: next });
    },
    [state.pinnedIds, storage, userId, route],
  );

  const unpin = useCallback(
    (id: string) => {
      const next = state.pinnedIds.filter((p) => p !== id);
      writePinned(storage, userId, route, next);
      dispatch({ kind: 'set_pinned', ids: next });
    },
    [state.pinnedIds, storage, userId, route],
  );

  const refresh = useCallback(() => {
    dispatch({ kind: 'refresh' });
  }, []);

  const shortcuts: ReadonlyArray<LearnedShortcut> | null = useMemo(() => {
    if (!userId || !route) return null;
    const rows: ReadonlyArray<UserActionTrackerRow> = state.cache?.rows ?? [];
    // Distinct-action count must exceed mastery threshold — counting
    // ids rather than rows so a duplicate row from UI-3 doesn't trick
    // the panel into showing on a sparse route.
    const distinct = new Set(rows.map((r) => r.id)).size;
    if (distinct < masteryThreshold) return null;
    return rankActions(rows, {
      topN,
      pinnedIds: state.pinnedIds,
    });
  }, [
    state.cache,
    state.pinnedIds,
    userId,
    route,
    masteryThreshold,
    topN,
  ]);

  return {
    shortcuts,
    isLoading: state.isLoading,
    error: state.error,
    pin,
    unpin,
    refresh,
  };
}
