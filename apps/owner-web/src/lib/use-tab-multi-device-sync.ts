'use client';

/**
 * useTabMultiDeviceSync — cross-device tab CRUD reconciliation (CT-5).
 *
 * When the owner is signed in on >1 device (e.g. desktop + tablet +
 * mobile cockpit), a brain-emitted `<tab_spawn>` from one device must
 * also appear on the others in <500 ms. The gateway already broadcasts
 * `cockpit.tab.spawned` / `.updated` / `.removed` / `.proposed` on the
 * tenant-scoped cockpit bus; this hook subscribes to those events
 * (via the existing `useCockpitStream`) and dispatches them into the
 * `useOwnerTabs()` store.
 *
 * Echo filter: each event carries `originDeviceId`. If we sent it, we
 * skip — the spawning device already applied the change locally
 * (optimistic UI). Otherwise we apply.
 *
 * Auth scope: every event also carries `userId`. We compare against
 * the current user; cross-user events within the same tenant are
 * dropped silently.
 *
 * Idempotency: the store's `spawnOrAugment` is deterministic by id, so
 * re-applying a spawn we already have augments instead of duplicating.
 * `applyUpdatePatch` is pure shallow-merge.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useCockpitStream } from './cockpit-sse';
import type {
  CockpitEvent,
  CockpitTabProposedEvent,
  CockpitTabRemovedEvent,
  CockpitTabSpawnedEvent,
  CockpitTabUpdatedEvent,
} from './cockpit-sse';
import { useOwnerTabs } from './owner-tabs-store';
import { isKnownTabKind } from './tab-sse-parser';

export interface UseTabMultiDeviceSyncOptions {
  /** Current signed-in user id — events for other users are ignored. */
  readonly userId: string;
  /**
   * Stable identifier of THIS browser tab / device. When the spawning
   * device receives its own broadcast back, we skip to avoid double-
   * apply. Generated client-side per session.
   */
  readonly deviceId: string;
  /** UI language for tab labels — defaults to 'en'. */
  readonly language?: 'sw' | 'en';
  /** Disable subscription (useful for tests). */
  readonly enabled?: boolean;
  /** Optional handler for proposal events — typically renders an in-app banner. */
  readonly onProposal?: (proposal: CockpitTabProposedEvent) => void;
}

export interface TabMultiDeviceSyncState {
  /** Total events the hook has applied to the store this session. */
  readonly applied: number;
  /** Total events the hook ignored (echo / wrong user / unknown kind). */
  readonly skipped: number;
  /** Last applied event kind — useful for debugging. */
  readonly lastAppliedKind: string | null;
}

const TAB_EVENT_KINDS = new Set<CockpitEvent['kind']>([
  'cockpit.tab.spawned',
  'cockpit.tab.updated',
  'cockpit.tab.removed',
  'cockpit.tab.proposed',
]);

export function useTabMultiDeviceSync(
  options: UseTabMultiDeviceSyncOptions,
): TabMultiDeviceSyncState {
  const { userId, deviceId, language = 'en', enabled = true } = options;
  const { spawnOrAugment, close, patchState, rename } = useOwnerTabs();

  // useState-backed counters so tests + components see the real-time
  // applied/skipped totals. We also keep refs to avoid stale closure
  // inside the SSE callback (it captures `userId` / `deviceId` /
  // `onProposal` once at mount otherwise).
  const [state, setState] = useState<TabMultiDeviceSyncState>({
    applied: 0,
    skipped: 0,
    lastAppliedKind: null,
  });
  const userIdRef = useRef(userId);
  userIdRef.current = userId;
  const deviceIdRef = useRef(deviceId);
  deviceIdRef.current = deviceId;
  const onProposalRef = useRef(options.onProposal);
  onProposalRef.current = options.onProposal;

  const handleEvent = useCallback(
    (event: CockpitEvent): void => {
      if (!enabled) return;
      if (!TAB_EVENT_KINDS.has(event.kind)) return;

      // Echo filter — skip events we ourselves originated. Proposals do
      // not carry originDeviceId (they're always server-originated).
      const eventUserId =
        'userId' in event ? (event as { userId: string }).userId : null;
      if (eventUserId !== userIdRef.current) {
        setState((prev) => ({ ...prev, skipped: prev.skipped + 1 }));
        return;
      }
      const originDeviceId =
        'originDeviceId' in event
          ? (event as { originDeviceId: string | null }).originDeviceId
          : null;
      if (originDeviceId && originDeviceId === deviceIdRef.current) {
        setState((prev) => ({ ...prev, skipped: prev.skipped + 1 }));
        return;
      }

      switch (event.kind) {
        case 'cockpit.tab.spawned': {
          const ev = event as CockpitTabSpawnedEvent;
          if (!isKnownTabKind(ev.tabType)) {
            setState((prev) => ({ ...prev, skipped: prev.skipped + 1 }));
            return;
          }
          spawnOrAugment({
            kind: ev.tabType,
            title: ev.title,
            context: ev.config,
          });
          setState((prev) => ({
            applied: prev.applied + 1,
            skipped: prev.skipped,
            lastAppliedKind: ev.kind,
          }));
          return;
        }
        case 'cockpit.tab.updated': {
          const ev = event as CockpitTabUpdatedEvent;
          if (ev.patch.title) rename(ev.tabId, ev.patch.title);
          if (ev.patch.config) patchState(ev.tabId, ev.patch.config);
          setState((prev) => ({
            applied: prev.applied + 1,
            skipped: prev.skipped,
            lastAppliedKind: ev.kind,
          }));
          return;
        }
        case 'cockpit.tab.removed': {
          const ev = event as CockpitTabRemovedEvent;
          close(ev.tabId);
          setState((prev) => ({
            applied: prev.applied + 1,
            skipped: prev.skipped,
            lastAppliedKind: ev.kind,
          }));
          return;
        }
        case 'cockpit.tab.proposed': {
          const ev = event as CockpitTabProposedEvent;
          onProposalRef.current?.(ev);
          setState((prev) => ({
            applied: prev.applied + 1,
            skipped: prev.skipped,
            lastAppliedKind: ev.kind,
          }));
          return;
        }
        default:
          setState((prev) => ({ ...prev, skipped: prev.skipped + 1 }));
      }
    },
    [enabled, language, spawnOrAugment, close, rename, patchState],
  );

  // We subscribe THROUGH the existing cockpit stream hook so the
  // EventSource is shared (no duplicate connections).
  const stream = useCockpitStream({ enabled, onEvent: handleEvent });

  // No-op effect — exists so React tracks `stream.connected` lifecycle.
  useEffect(() => {
    // intentionally empty — `useCockpitStream` already manages teardown
    return undefined;
  }, [stream.connected]);

  return state;
}

/**
 * Generate a stable per-browser-tab device id. Persists in
 * `sessionStorage` so it survives page reloads but resets on a new
 * tab. SSR-safe (returns a sentinel during render-on-server).
 */
export function ensureTabDeviceId(): string {
  if (typeof window === 'undefined') return 'ssr';
  const KEY = 'borjie:owner-cockpit:device-id';
  let id = window.sessionStorage.getItem(KEY);
  if (!id) {
    id =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `d_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    window.sessionStorage.setItem(KEY, id);
  }
  return id;
}

/**
 * Hook variant of `ensureTabDeviceId` — memoised so React doesn't
 * thrash the `useTabMultiDeviceSync` deps array.
 */
export function useTabDeviceId(): string {
  return useMemo(() => ensureTabDeviceId(), []);
}

