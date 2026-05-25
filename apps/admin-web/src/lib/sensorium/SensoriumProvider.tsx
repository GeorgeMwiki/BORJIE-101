'use client';

/**
 * SensoriumProvider — Central Command Phase A (C4 Brain Skin).
 *
 * Wires the `SensoriumBus` to all 14 event handlers on mount and
 * exposes:
 *   - `useSensoriumBus()` — read access to the active bus instance
 *     so other components (the chat client, the AG-UI hook) can
 *     attach the presence packet to outgoing turns.
 *   - `useA11ySnapshot()` — current accessibility-tree snapshot,
 *     debounced via the `a11y.tree.diff` handler.
 *
 * The provider is `'use client'` so Next 15 only loads it client-side.
 * SSR renders the children untouched.
 */

import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { SensoriumBus } from './event-bus-client.js';
import { ALL_HANDLERS } from './event-handlers/index.js';
import {
  snapshotA11yTree,
  type A11ySnapshot,
} from './a11y-tree-snapshot.js';
import { assemblePresence, type PresencePacket } from './presence-packet.js';

interface SensoriumContextValue {
  readonly bus: SensoriumBus | null;
  readonly snapshot: A11ySnapshot | null;
  readonly assemblePresencePacket: () => PresencePacket;
}

const SensoriumContext = createContext<SensoriumContextValue>({
  bus: null,
  snapshot: null,
  assemblePresencePacket: () => assemblePresence({ surface: 'unknown' }),
});

export interface SensoriumProviderProps {
  readonly surface?: string;
  readonly sessionId?: string;
  readonly endpoint?: string;
  readonly enabled?: boolean;
  readonly children: React.ReactNode;
}

function generateSessionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `sess_${crypto.randomUUID()}`;
  }
  return `sess_${Date.now()}_${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`;
}

export function SensoriumProvider(props: SensoriumProviderProps): React.ReactElement {
  const {
    surface = 'admin-web',
    sessionId: sessionIdProp,
    endpoint,
    enabled = true,
    children,
  } = props;

  const sessionIdRef = useRef<string>(sessionIdProp ?? '');
  if (!sessionIdRef.current) sessionIdRef.current = generateSessionId();

  const [snapshot, setSnapshot] = useState<A11ySnapshot | null>(null);
  const [bus, setBus] = useState<SensoriumBus | null>(null);
  const lastQueryAtRef = useRef<number | undefined>(undefined);

  // Install the bus and all handlers on mount. The Provider is the
  // single source of truth for `route()` — every handler asks back
  // via the ctx callback so it stays consistent with the actual URL.
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;
    const activeBus = new SensoriumBus({
      sessionId: sessionIdRef.current,
      surface,
      ...(endpoint ? { endpoint } : {}),
    });
    activeBus.start();
    setBus(activeBus);

    const ctx = {
      route: () =>
        typeof window !== 'undefined'
          ? `${window.location.pathname}${window.location.search}`
          : '/',
      surface,
    };
    const teardowns = ALL_HANDLERS.map((h) =>
      h.install((ev) => activeBus.emit(ev), ctx),
    );
    // Seed snapshot.
    setSnapshot(snapshotA11yTree());

    // Subscribe to a11y diffs by polling at 1Hz — the dedicated diff
    // handler does the work, this is the React-state mirror.
    const snapPoll = setInterval(() => {
      setSnapshot((prev) => {
        const next = snapshotA11yTree();
        if (prev && prev.digest === next.digest) return prev;
        return next;
      });
    }, 1000);

    return () => {
      clearInterval(snapPoll);
      for (const t of teardowns) {
        try {
          t();
        } catch {
          // Teardowns must never throw — best-effort cleanup.
        }
      }
      activeBus.stop();
      setBus(null);
    };
    // surface + sessionId + endpoint + enabled are stable per provider
    // mount; restart on any change. eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, surface, endpoint]);

  const value = useMemo<SensoriumContextValue>(
    () => ({
      bus,
      snapshot,
      assemblePresencePacket: () =>
        assemblePresence({
          surface,
          ...(lastQueryAtRef.current
            ? { lastQueryAt: lastQueryAtRef.current }
            : {}),
          ...(snapshot ? { snapshot } : {}),
        }),
    }),
    [bus, snapshot, surface],
  );

  return (
    <SensoriumContext.Provider value={value}>
      {children}
    </SensoriumContext.Provider>
  );
}

/** Hook — read the active bus. Returns null during SSR / before mount. */
export function useSensoriumBus(): SensoriumBus | null {
  return useContext(SensoriumContext).bus;
}

/** Hook — read the live a11y snapshot. */
export function useA11ySnapshot(): A11ySnapshot | null {
  return useContext(SensoriumContext).snapshot;
}

/** Hook — assemble a fresh presence packet on demand. */
export function usePresencePacket(): () => PresencePacket {
  return useContext(SensoriumContext).assemblePresencePacket;
}
