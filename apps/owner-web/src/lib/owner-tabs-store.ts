'use client';

/**
 * useOwnerTabsStore — owner-cockpit dynamic tab strip state.
 *
 * Wave OWNER-OS / OWNER-OS-DYNAMIC. The cockpit home is a tab strip the
 * owner can spawn / pin / close / reorder. Tabs survive sign-out + sign-in
 * because the state is persisted to:
 *
 *   1. `localStorage` (fast hydration on next visit, even offline),
 *   2. `PUT /api/v1/owner/tabs` (server-side, cross-device sync).
 *
 * On mount we read localStorage first (no flash), then fetch from the
 * server. If the server payload is newer (server `updatedAt` >
 * localStorage updatedAt) we adopt it; otherwise we push our local
 * state up so the server matches.
 *
 * Phase 2 refinement — DEDUP + AUGMENT-IN-PLACE:
 *
 *   When the brain or owner asks for a tab type that ALREADY exists in the
 *   current strip, do NOT spawn a duplicate. Instead, AUGMENT the existing
 *   tab in place:
 *
 *     - Merge new context fields into the open tab's `context` object.
 *       Conflicting scalars become arrays (e.g. `focus` becomes
 *       `["NEMC EIA Geita", "BoT gold-window"]`).
 *     - Set an `indicator: 'hint'` so the tab strip renders a "+1 update"
 *       badge on the pip — the owner notices what changed.
 *     - Bump `augmentedAt` so panels watching with `useTabAugmentation`
 *       can fade-in the new rows / fields without remount.
 *
 *   See `spawnOrAugment(tabType, context)` below — returns the existing
 *   tabId when a match is found, else a freshly-spawned tabId. Visual
 *   augmentation is each panel's responsibility (panels render with a
 *   stable `key={tabId}` so React preserves state across context merges).
 *
 * Public surface:
 *   - `useOwnerTabs()` — hook returning the store API including the new
 *     `spawnOrAugment` and `acknowledgeAugmentation` methods.
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
  | 'doc-context'
  | 'hr'
  | 'ops'
  | 'finance'
  | 'accounting'
  | 'risk'
  | 'compliance'
  | 'workforce'
  | 'procurement'
  | 'audit'
  | 'legal'
  | 'esg'
  | 'geology'
  | 'treasury'
  | 'marketplace'
  | 'licences'
  | 'sites'
  | 'safety'
  | 'reports';

export interface OwnerTab {
  /** Stable id. Deterministic by (kind, context) for dedup; literal for built-ins. */
  readonly id: string;
  /** Kind drives the panel renderer. */
  readonly kind: OwnerTabKind;
  /** Display label. */
  readonly title: string;
  /** Optional context payload. Conflicting scalars become arrays on augment. */
  readonly context?: Readonly<Record<string, unknown>>;
  /** Sticky / built-in tabs cannot be closed via the X button. */
  readonly pinned?: boolean;
  /** Optional cached state per-tab (draft message, scroll, etc.). */
  readonly state?: Readonly<Record<string, unknown>>;
  /** ISO 8601 — when the brain / owner last AUGMENTED this tab (added context). */
  readonly augmentedAt?: string;
  /**
   * Count of unacknowledged augmentations since the owner last focused.
   * Renders as a "+N" badge on the tab pip in the strip.
   */
  readonly pendingUpdates?: number;
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
// Context merge — conflicting scalars become arrays so augmentation never
// silently overwrites. The Compliance example in the spec:
//
//   existing.context = { focus: "NEMC EIA Geita" }
//   incoming        = { focus: "BoT gold-window" }
//   merged          = { focus: ["NEMC EIA Geita", "BoT gold-window"] }
//
// Arrays are deduped. Nested objects are shallow-merged (rare).
// ---------------------------------------------------------------------------

function unique<T>(arr: ReadonlyArray<T>): ReadonlyArray<T> {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const v of arr) {
    const key = typeof v === 'string' ? v : JSON.stringify(v);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(v);
    }
  }
  return out;
}

function mergeContextValue(prev: unknown, next: unknown): unknown {
  if (prev === undefined || prev === null) return next;
  if (next === undefined || next === null) return prev;
  if (Array.isArray(prev) && Array.isArray(next)) {
    return unique([...prev, ...next]);
  }
  if (Array.isArray(prev)) return unique([...prev, next]);
  if (Array.isArray(next)) return unique([prev, ...next]);
  // Same scalar — keep as-is.
  if (prev === next) return prev;
  // Different scalars — promote to array.
  if (
    typeof prev !== 'object' &&
    typeof next !== 'object'
  ) {
    return unique([prev, next]);
  }
  // Two objects — shallow merge.
  if (typeof prev === 'object' && typeof next === 'object') {
    return { ...(prev as object), ...(next as object) };
  }
  // Mixed object + scalar — promote to array.
  return [prev, next];
}

export function mergeTabContext(
  prev: Readonly<Record<string, unknown>> | undefined,
  next: Readonly<Record<string, unknown>> | undefined,
): Record<string, unknown> {
  const a = prev ?? {};
  const b = next ?? {};
  const out: Record<string, unknown> = { ...a };
  for (const k of Object.keys(b)) {
    out[k] = mergeContextValue(a[k], b[k]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Deterministic id builder — re-spawning the same (kind, scoping context)
// produces the same id so the reducer's exists-check catches it.
// ---------------------------------------------------------------------------

const SCOPING_KEYS: ReadonlyArray<string> = [
  'siteId',
  'licenceId',
  'employeeId',
  'counterpartyId',
  'documentId',
];

export function deterministicTabId(
  kind: OwnerTabKind,
  context: Readonly<Record<string, unknown>> | undefined,
): string {
  // Built-ins keep their literal id.
  if (
    kind === 'chat' ||
    kind === 'docs' ||
    kind === 'drafts' ||
    kind === 'reminders' ||
    kind === 'insights'
  ) {
    return kind;
  }
  const ctx = context ?? {};
  const parts: string[] = [kind];
  for (const key of SCOPING_KEYS) {
    const v = ctx[key];
    if (typeof v === 'string' && v.length > 0) {
      parts.push(`${key}:${v}`);
    }
  }
  return parts.join('|');
}

// ---------------------------------------------------------------------------
// Reducer — every mutation produces a NEW state object (immutable).
// ---------------------------------------------------------------------------

type Action =
  | { type: 'hydrate'; state: OwnerTabsState }
  | { type: 'open'; tab: OwnerTab }
  | {
      type: 'spawn-or-augment';
      tab: OwnerTab;
      mergedTabId: string;
      isNew: boolean;
    }
  | { type: 'close'; tabId: string }
  | { type: 'focus'; tabId: string }
  | { type: 'rename'; tabId: string; title: string }
  | { type: 'replace-state'; tabId: string; patch: Record<string, unknown> }
  | { type: 'acknowledge-augmentation'; tabId: string };

function reducer(state: OwnerTabsState, action: Action): OwnerTabsState {
  switch (action.type) {
    case 'hydrate':
      return action.state;
    case 'open': {
      const exists = state.tabs.find((t) => t.id === action.tab.id);
      const tabs = exists ? state.tabs : [...state.tabs, action.tab];
      return {
        tabs,
        activeTabId: action.tab.id,
        updatedAt: new Date().toISOString(),
      };
    }
    case 'spawn-or-augment': {
      const now = new Date().toISOString();
      const existing = state.tabs.find((t) => t.id === action.mergedTabId);
      if (!existing) {
        return {
          tabs: [...state.tabs, action.tab],
          activeTabId: action.tab.id,
          updatedAt: now,
        };
      }
      // Augment in place — merge context, bump update counter, mark
      // augmentedAt for `useTabAugmentation` watchers.
      const merged: OwnerTab = {
        ...existing,
        context: mergeTabContext(existing.context, action.tab.context),
        augmentedAt: now,
        pendingUpdates:
          state.activeTabId === existing.id
            ? 0
            : (existing.pendingUpdates ?? 0) + 1,
      };
      const tabs = state.tabs.map((t) => (t.id === existing.id ? merged : t));
      return {
        tabs,
        // Keep current focus unless caller explicitly switches — augmentation
        // should never yank the owner out of what they were reading.
        activeTabId: state.activeTabId,
        updatedAt: now,
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
    case 'focus': {
      if (!state.tabs.some((t) => t.id === action.tabId)) return state;
      // Clear pendingUpdates when the owner focuses the tab.
      const tabs = state.tabs.map((t) =>
        t.id === action.tabId && (t.pendingUpdates ?? 0) > 0
          ? { ...t, pendingUpdates: 0 }
          : t,
      );
      return {
        tabs,
        activeTabId: action.tabId,
        updatedAt: new Date().toISOString(),
      };
    }
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
    case 'acknowledge-augmentation':
      return {
        ...state,
        tabs: state.tabs.map((t) =>
          t.id === action.tabId ? { ...t, pendingUpdates: 0 } : t,
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

export interface SpawnOrAugmentInput {
  /** The tab kind to ensure is present. */
  readonly kind: OwnerTabKind;
  /** Display label used when a fresh tab is spawned. Ignored for augment. */
  readonly title: string;
  /** Optional context. Merged into the existing tab on dedup. */
  readonly context?: Readonly<Record<string, unknown>>;
}

export interface SpawnOrAugmentResult {
  /** The resolved tabId (existing on augment, new on spawn). */
  readonly tabId: string;
  /** True when a fresh tab was created; false when an existing tab was augmented. */
  readonly isNew: boolean;
}

export interface UseOwnerTabsApi {
  readonly tabs: ReadonlyArray<OwnerTab>;
  readonly activeTabId: string | null;
  readonly activeTab: OwnerTab | null;
  open(tab: OwnerTab): void;
  /**
   * Idempotent spawn — returns the existing tab id when one matches the
   * (kind, scoping-context) fingerprint, else opens a fresh tab. The
   * returned `isNew` lets the caller decide whether to also focus.
   */
  spawnOrAugment(input: SpawnOrAugmentInput): SpawnOrAugmentResult;
  /** Clear the "+N" badge for a tab (called when its panel becomes visible). */
  acknowledgeAugmentation(tabId: string): void;
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
  const stateRef = useRef(state);
  stateRef.current = state;

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
          const localUpdatedAt = stateRef.current.updatedAt;
          if (
            serverUpdatedAt > localUpdatedAt &&
            Array.isArray(serverState.tabs) &&
            serverState.tabs.length > 0
          ) {
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
        // 401 / 503 / network — fall back to local.
      }
    })();
    return () => {
      cancelled = true;
    };
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
      })
        .then(() => {
          lastServerSync.current = state.updatedAt;
        })
        .catch(() => {
          // Best-effort; localStorage is authoritative.
        });
    }, SYNC_DEBOUNCE_MS);
  }, [state]);

  const open = useCallback(
    (tab: OwnerTab) => dispatch({ type: 'open', tab }),
    [],
  );
  const close = useCallback(
    (tabId: string) => dispatch({ type: 'close', tabId }),
    [],
  );
  const focus = useCallback(
    (tabId: string) => dispatch({ type: 'focus', tabId }),
    [],
  );
  const rename = useCallback(
    (tabId: string, title: string) =>
      dispatch({ type: 'rename', tabId, title }),
    [],
  );
  const patchState = useCallback(
    (tabId: string, patch: Record<string, unknown>) =>
      dispatch({ type: 'replace-state', tabId, patch }),
    [],
  );
  const acknowledgeAugmentation = useCallback(
    (tabId: string) => dispatch({ type: 'acknowledge-augmentation', tabId }),
    [],
  );

  const spawnOrAugment = useCallback(
    (input: SpawnOrAugmentInput): SpawnOrAugmentResult => {
      const mergedTabId = deterministicTabId(input.kind, input.context);
      const existing = stateRef.current.tabs.find((t) => t.id === mergedTabId);
      const isNew = !existing;
      const tab: OwnerTab = {
        id: mergedTabId,
        kind: input.kind,
        title: input.title,
        ...(input.context !== undefined && { context: input.context }),
      };
      dispatch({ type: 'spawn-or-augment', tab, mergedTabId, isNew });
      return { tabId: mergedTabId, isNew };
    },
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
    spawnOrAugment,
    acknowledgeAugmentation,
    close,
    focus,
    rename,
    patchState,
  };
}
