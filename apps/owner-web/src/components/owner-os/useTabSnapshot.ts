'use client';

/**
 * useTabSnapshot — persist a tiny per-tab render snapshot to localStorage
 * so the sleeper can show it instantly when the tab wakes.
 *
 * Wave OWNER-OS-DYNAMIC Phase 2 — INTELLIGENT LAZY-LOAD + SLEEP.
 *
 * Each panel calls `useTabSnapshot(tabId, build)` once per render. The
 * hook serialises whatever `build()` returns (small, JSON-serialisable
 * payload — title, KPI counts, last 3 row labels, etc.) under the key
 * `borjie:tab-snapshot:<tabId>`. On wake, `<TabSleeper>` reads the
 * snapshot and renders the panel's `Snapshot` mode (a skeleton-shaped
 * placeholder) BEFORE the live panel mounts, so the owner never sees a
 * skeleton-flash.
 *
 * Keep snapshots TINY — under 4 KB stringified. localStorage quotas are
 * small and the snapshot is cosmetic, never authoritative.
 *
 * Companion: `readTabSnapshot(tabId)` is the reader used by
 * `<TabSleeper>`. The writer is throttled to 1 write per ~500ms per tab
 * so a busy render loop does not thrash localStorage.
 */

import { useEffect, useRef } from 'react';

const SNAPSHOT_PREFIX = 'borjie:tab-snapshot:';
const WRITE_THROTTLE_MS = 500;
const MAX_BYTES = 4_096;

export interface TabSnapshotData {
  /** Schema version so we can evolve the snapshot shape later. */
  readonly v: 1;
  /** ISO timestamp the snapshot was last written. */
  readonly capturedAt: string;
  /** Panel-shaped payload — keep small. */
  readonly payload: Record<string, unknown>;
}

function storageKey(tabId: string): string {
  return `${SNAPSHOT_PREFIX}${tabId}`;
}

/**
 * Read a previously-stored snapshot for a tab. Returns `null` when none
 * exists or when the payload is corrupted.
 */
export function readTabSnapshot(tabId: string): TabSnapshotData | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(storageKey(tabId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as TabSnapshotData;
    if (parsed && parsed.v === 1 && typeof parsed.payload === 'object') {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Drop a tab's snapshot (e.g. when the tab is closed). Safe no-op on the
 * server.
 */
export function dropTabSnapshot(tabId: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(storageKey(tabId));
  } catch {
    /* ignore quota / privacy errors */
  }
}

/**
 * Throttled snapshot writer. Call from a panel's body — re-runs on each
 * render but only commits to localStorage at most once per
 * `WRITE_THROTTLE_MS`.
 */
export function useTabSnapshot(
  tabId: string,
  build: () => Record<string, unknown>,
): void {
  const lastWrite = useRef<number>(0);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const commit = () => {
      try {
        const snapshot: TabSnapshotData = {
          v: 1,
          capturedAt: new Date().toISOString(),
          payload: build(),
        };
        const serialised = JSON.stringify(snapshot);
        if (serialised.length > MAX_BYTES) {
          // Too big — drop the payload, keep the shape so wake still
          // shows "something" instead of a hard skeleton.
          const trimmed: TabSnapshotData = {
            v: 1,
            capturedAt: snapshot.capturedAt,
            payload: { truncated: true },
          };
          window.localStorage.setItem(
            storageKey(tabId),
            JSON.stringify(trimmed),
          );
        } else {
          window.localStorage.setItem(storageKey(tabId), serialised);
        }
        lastWrite.current = Date.now();
      } catch {
        /* quota / serialisation — silently drop */
      }
    };

    const now = Date.now();
    const sinceLast = now - lastWrite.current;
    if (sinceLast >= WRITE_THROTTLE_MS) {
      commit();
      return undefined;
    }
    if (pending.current) clearTimeout(pending.current);
    pending.current = setTimeout(commit, WRITE_THROTTLE_MS - sinceLast);
    return () => {
      if (pending.current) clearTimeout(pending.current);
    };
  });
}
