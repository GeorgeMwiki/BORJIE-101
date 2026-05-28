'use client';

/**
 * useOwnerTabsStore — owner-cockpit dynamic tab strip state.
 *
 * Wave OWNER-OS. The cockpit home is a tab strip the owner can spawn /
 * pin / close / reorder. Tabs survive sign-out + sign-in because the
 * state is persisted to:
 *
 *   1. `localStorage` (fast hydration on next visit, even offline),
 *   2. `PUT /api/v1/owner/tabs` (server-side, cross-device sync).
 *
 * On mount we read localStorage first (no flash), then fetch from the
 * server. If the server payload is newer (server `updatedAt` >
 * localStorage updatedAt) we adopt it; otherwise we push our local
 * state up so the server matches.
 *
 * Public surface:
 *   - `useOwnerTabs()` — hook returning `{ tabs, activeTabId, open,
 *     close, focus, rename, replace }`. Every mutation persists locally
 *     (synchronously) and schedules a debounced server sync.
 */

import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import { apiRequest } from '@/lib/api-client';

const STORAGE_KEY = 'borjie:owner-tabs:v1';
const SYNC_DEBOUNCE_MS = 800;

export type OwnerTabKind =
  | 'chat'
  | 'docs'
  | 'drafts'
  | 'reminders'
  | 'insights'
  | 'doc-context';

export interface OwnerTab {
  /** Stable id. UUID for spawn-tabs; literal for built-ins. */
  readonly id: string;
  /** Kind drives the panel renderer. */
  readonly kind: OwnerTabKind;
  /** Display label. */
  readonly title: string;
  /** Optional context payload (e.g. documentId for doc-context). */
  readonly context?: Readonly<Record<string, unknown>>;
  /** Sticky / built-in tabs cannot be closed via the X button. */
  readonly pinned?: boolean;
  /** Optional cached state per-tab (draft message, scroll, etc.). */
  readonly state?: Readonly<Record<string, unknown>>;
}

export interface OwnerTabsState {
  readonly tabs: ReadonlyArray<OwnerTab>;
  readonly activeTabId: string | null;
  readonly updatedAt: string;
}

const DEFAULT_STATE: OwnerTabsState = {
  tabs: [
    { id: 'chat', kind: 'chat', title: 'Chat', pinned: true },
    { id: 'docs', kind: 'docs', title: 'Docs', pinned: true },
    { id: 'drafts', kind: 'drafts', title: 'Drafts', pinned: true },
    { id: 'reminders', kind: 'reminders', title: 'Reminders', pinned: true },
    { id: 'insights', kind: 'insights', title: 'Insights', pinned: true },
  ],
  activeTabId: 'chat',
  updatedAt: new Date(0).toISOString(),
};

// ---------------------------------------------------------------------------
// Reducer — every mutation produces a NEW state object (immutable).
// ---------------------------------------------------------------------------

type Action =
  | { type: 'hydrate'; state: OwnerTabsState }
  | { type: 'open'; tab: OwnerTab }
  | { type: 'close'; tabId: string }
  | { type: 'focus'; tabId: string }
  | { type: 'rename'; tabId: string; title: string }
  | { type: 'replace-state'; tabId: string; patch: Record<string, unknown> };

function reducer(state: OwnerTabsState, action: Action): OwnerTabsState {
  switch (action.type) {
    case 'hydrate':
      return action.state;
    case 'open': {
      const exists = state.tabs.find((t) => t.id === action.tab.id);
      const tabs = exists
        ? state.tabs
        : [...state.tabs, action.tab];
      return {
        tabs,
        activeTabId: action.tab.id,
        updatedAt: new Date().toISOString(),
      };
    }
    case 'close': {
      const removed = state.tabs.find((t) => t.id === action.tabId);
      if (!removed || removed.pinned) return state;
      const tabs = state.tabs.filter((t) => t.id !== action.tabId);
      const nextActive =
        state.activeTabId === action.tabId
          ? tabs[0]?.id ?? null
          : state.activeTabId;
      return {
        tabs,
        activeTabId: nextActive,
        updatedAt: new Date().toISOString(),
      };
    }
    case 'focus':
      if (!state.tabs.some((t) => t.id === action.tabId)) return state;
      return {
        ...state,
        activeTabId: action.tabId,
        updatedAt: new Date().toISOString(),
      };
    case 'rename':
      return {
        ...state,
        tabs: state.tabs.map((t) =>
          t.id === action.tabId ? { ...t, title: action.title } : t,
        ),
        updatedAt: new Date().toISOString(),
      };
    case 'replace-state':
      return {
        ...state,
        tabs: state.tabs.map((t) =>
          t.id === action.tabId
            ? { ...t, state: { ...(t.state ?? {}), ...action.patch } }
            : t,
        ),
        updatedAt: new Date().toISOString(),
      };
    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// localStorage helpers
// ---------------------------------------------------------------------------

function readLocal(): OwnerTabsState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as OwnerTabsState;
    if (!parsed || !Array.isArray(parsed.tabs)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeLocal(state: OwnerTabsState): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // quota or private-mode — silently drop, server sync is the backup
  }
}

// ---------------------------------------------------------------------------
// Public hook
// ---------------------------------------------------------------------------

export interface UseOwnerTabsApi {
  readonly tabs: ReadonlyArray<OwnerTab>;
  readonly activeTabId: string | null;
  readonly activeTab: OwnerTab | null;
  open(tab: OwnerTab): void;
  close(tabId: string): void;
  focus(tabId: string): void;
  rename(tabId: string, title: string): void;
  patchState(tabId: string, patch: Record<string, unknown>): void;
}

export function useOwnerTabs(): UseOwnerTabsApi {
  const [state, dispatch] = useReducer(
    reducer,
    null,
    () => readLocal() ?? DEFAULT_STATE,
  );
  const initial = useRef(true);
  const lastServerSync = useRef<string | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Hydrate from server once on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiRequest<{
          state: Record<string, unknown>;
          updatedAt: string | null;
        }>(`/api/v1/owner/tabs`, { method: 'GET' });
        if (cancelled) return;
        if (res?.state && typeof res.state === 'object') {
          const serverState = res.state as unknown as Partial<OwnerTabsState>;
          const serverUpdatedAt = res.updatedAt ?? new Date(0).toISOString();
          // Adopt server state only when newer than local.
          const localUpdatedAt = state.updatedAt;
          if (serverUpdatedAt > localUpdatedAt && Array.isArray(serverState.tabs) && serverState.tabs.length > 0) {
            dispatch({
              type: 'hydrate',
              state: {
                tabs: serverState.tabs as ReadonlyArray<OwnerTab>,
                activeTabId: serverState.activeTabId ?? null,
                updatedAt: serverUpdatedAt,
              },
            });
            lastServerSync.current = serverUpdatedAt;
          }
        }
      } catch {
        // 401 = unauthenticated, 503 = degraded — both fall back to
        // local. Other failures are intentionally swallowed so a flaky
        // network never blocks the cockpit; localStorage carries us.
      }
    })();
    return () => {
      cancelled = true;
    };
    // Run once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist + debounced server sync on every change.
  useEffect(() => {
    if (initial.current) {
      initial.current = false;
      return;
    }
    writeLocal(state);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => {
      void apiRequest(`/api/v1/owner/tabs`, {
        method: 'PUT',
        body: { state },
      }).then(() => {
        lastServerSync.current = state.updatedAt;
      }).catch(() => {
        // Server sync is best-effort; localStorage already has the
        // authoritative copy. A retry happens on the next state change.
      });
    }, SYNC_DEBOUNCE_MS);
  }, [state]);

  const open = useCallback((tab: OwnerTab) => dispatch({ type: 'open', tab }), []);
  const close = useCallback((tabId: string) => dispatch({ type: 'close', tabId }), []);
  const focus = useCallback((tabId: string) => dispatch({ type: 'focus', tabId }), []);
  const rename = useCallback(
    (tabId: string, title: string) => dispatch({ type: 'rename', tabId, title }),
    [],
  );
  const patchState = useCallback(
    (tabId: string, patch: Record<string, unknown>) =>
      dispatch({ type: 'replace-state', tabId, patch }),
    [],
  );

  const activeTab = useMemo(
    () => state.tabs.find((t) => t.id === state.activeTabId) ?? null,
    [state.tabs, state.activeTabId],
  );

  return {
    tabs: state.tabs,
    activeTabId: state.activeTabId,
    activeTab,
    open,
    close,
    focus,
    rename,
    patchState,
  };
}
