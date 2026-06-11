'use client';

/**
 * useTabMultiDeviceSync — the PRIMARY cross-device chat→tab live-linkage path.
 *
 * The owner cockpit tab strip must stay in lockstep across every device the
 * owner is signed in on (desktop + tablet + mobile cockpit). When the brain
 * or owner spawns / updates / removes a tab from one device, the others must
 * reconcile in <2s — and crucially, INDEPENDENTLY of the chat stream. If a
 * chat turn stalls (a wedged generation, a dropped socket), tab sync must
 * keep flowing.
 *
 * This hook subscribes to the DEDICATED decoupled SSE channel
 * `GET /api/v1/portal-genui/tabs/subscribe` (NOT the in-band chat stream and
 * NOT the 30-kind `/cockpit/stream` multiplex). The gateway re-emits ONLY the
 * four tab-CRUD events on that channel, USER-scoped and echo-filtered, in the
 * same `tab_spawn` / `tab_update` / `tab_remove` / `tab_proposal` wire shape
 * the in-band `handleTabSseFrame` dispatcher already understands — so one
 * dispatcher serves both the in-band fast path (single device) and this
 * cross-device path (all devices).
 *
 * Echo filter: the caller's `deviceId` rides the subscribe URL so the gateway
 * never replays this device's OWN broadcasts back to it (the spawning device
 * already applied the change optimistically via the in-band fast path).
 *
 * Idempotency: the store's `spawnOrAugment` is deterministic by (kind,
 * scoping-context), so re-applying a spawn we already have augments instead
 * of duplicating. `patchState` / `rename` are pure shallow-merges.
 *
 * Auth: `EventSource` cannot set custom headers, so the gateway accepts the
 * Supabase session cookie (`withCredentials`) — identical to every other
 * owner-web SSE channel. No bearer token is exposed in the URL.
 */

import { useEffect, useMemo, useState } from 'react';

import { API_BASE } from '@/lib/api-client';
import {
  handleTabSseFrame,
  isKnownTabKind,
  spawnPayloadToTab,
  type TabProposalPayload,
} from '@/lib/tab-sse-parser';
import { useOwnerTabs, type OwnerTabKind } from '@/lib/owner-tabs-store';
import { ensureTabDeviceId } from '@/lib/use-tab-multi-device-sync';

export interface UseTabMultiDeviceSyncOptions {
  /** Current signed-in user id — the channel is user-scoped server-side. */
  readonly userId: string;
  /**
   * Stable identifier of THIS browser tab / device. The gateway uses it to
   * echo-filter the caller's own broadcasts. Defaults to a per-session id.
   */
  readonly deviceId?: string;
  /** UI language for locale-correct tab labels — defaults to 'en'. */
  readonly language?: 'sw' | 'en';
  /** Disable the subscription (tests / signed-out). Defaults to enabled. */
  readonly enabled?: boolean;
  /**
   * Optional handler for proposal frames — typically renders an in-app
   * accept/dismiss banner rather than spawning silently.
   */
  readonly onProposal?: (proposal: TabProposalPayload) => void;
}

export interface TabMultiDeviceSyncState {
  /** True while the dedicated tab channel is connected. */
  readonly connected: boolean;
  /** Total tab frames applied to the store this session. */
  readonly applied: number;
  /** Last applied SSE event name — useful for debugging. */
  readonly lastAppliedEvent: string | null;
}

const INITIAL_STATE: TabMultiDeviceSyncState = Object.freeze({
  connected: false,
  applied: 0,
  lastAppliedEvent: null,
});

/** The four SSE event names the dedicated tab channel emits. */
const TAB_SUBSCRIBE_EVENTS = [
  'tab_spawn',
  'tab_update',
  'tab_remove',
  'tab_proposal',
] as const;

export function useTabMultiDeviceSync(
  options: UseTabMultiDeviceSyncOptions,
): TabMultiDeviceSyncState {
  const { userId, language = 'en', enabled = true } = options;
  const { spawnOrAugment, close, patchState, rename } = useOwnerTabs();

  // A stable per-session device id when the caller does not supply one, so
  // the server can echo-filter this device's own broadcasts.
  const deviceId = useMemo(
    () => options.deviceId ?? ensureTabDeviceId(),
    [options.deviceId],
  );

  const [state, setState] = useState<TabMultiDeviceSyncState>(INITIAL_STATE);

  // Capture the locale + proposal handler so the SSE listeners (registered
  // once per connection) never read a stale closure.
  const onProposal = options.onProposal;

  useEffect(() => {
    if (!enabled) {
      setState(INITIAL_STATE);
      return undefined;
    }
    if (typeof window === 'undefined' || typeof EventSource === 'undefined') {
      return undefined;
    }

    const url =
      `${API_BASE.replace(/\/+$/, '')}/api/v1/portal-genui/tabs/subscribe` +
      `?deviceId=${encodeURIComponent(deviceId)}`;

    let source: EventSource;
    try {
      source = new EventSource(url, { withCredentials: true });
    } catch {
      setState(INITIAL_STATE);
      return undefined;
    }

    const markApplied = (eventName: string): void =>
      setState((prev) => ({
        connected: true,
        applied: prev.applied + 1,
        lastAppliedEvent: eventName,
      }));

    const onFrame = (eventName: string) => (raw: MessageEvent): void => {
      if (typeof raw.data !== 'string') return;
      const applied = handleTabSseFrame({
        eventName,
        rawData: raw.data,
        handlers: {
          onSpawn: (p) => {
            const tab = spawnPayloadToTab(p, language);
            if (!tab) return;
            const input: {
              kind: OwnerTabKind;
              title: string;
              context?: Readonly<Record<string, unknown>>;
            } = { kind: tab.kind, title: tab.title };
            if (tab.context && Object.keys(tab.context).length > 0) {
              input.context = tab.context;
            }
            spawnOrAugment(input);
          },
          onUpdate: (p) => {
            if (p.patch.config) patchState(p.tabId, p.patch.config);
            const title =
              (language === 'sw' && p.titleSw) ||
              (language === 'en' && p.titleEn) ||
              p.patch.title;
            if (title) rename(p.tabId, title);
          },
          onRemove: (p) => {
            close(p.tabId);
          },
          onProposal: (p) => {
            // Unknown tab types never spawn silently — surface a chip via the
            // caller's banner. Drop quietly when the type is not renderable.
            if (!isKnownTabKind(p.tabType)) return;
            onProposal?.(p);
          },
        },
      });
      if (applied) markApplied(eventName);
    };

    source.addEventListener('connected', () => {
      setState((prev) => ({ ...prev, connected: true }));
    });
    for (const eventName of TAB_SUBSCRIBE_EVENTS) {
      source.addEventListener(
        eventName,
        onFrame(eventName) as EventListener,
      );
    }
    source.addEventListener('error', () => {
      setState((prev) => ({ ...prev, connected: false }));
    });

    return () => {
      source.close();
      setState(INITIAL_STATE);
    };
    // `userId` is in the dep list so a user switch re-opens the (now
    // differently-scoped) channel.
  }, [
    enabled,
    deviceId,
    userId,
    language,
    spawnOrAugment,
    close,
    patchState,
    rename,
    onProposal,
  ]);

  return state;
}
