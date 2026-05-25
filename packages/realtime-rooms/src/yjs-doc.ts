/**
 * Yjs CRDT document binding for Liveblocks rooms.
 *
 * Pattern: `@liveblocks/yjs` exposes a `LiveblocksYjsProvider` that
 * shuttles Yjs awareness + updates over the Liveblocks websocket. The
 * brain participates by writing to the same `Y.Doc` — the CRDT merge
 * means human + brain edits NEVER stomp each other.
 *
 * This module exposes a framework-agnostic surface
 * ({@link createYjsBinding}) and a React-shape hook
 * ({@link useDocumentBindingFactory}) that portals wrap in their own
 * `useDocumentBinding(roomId)` once they decide how to inject the
 * `react` hooks (each portal's bundler controls React resolution).
 */

import * as Y from 'yjs';
import type { LiveblocksRoom } from './client.js';

export type YjsBindingStatus = 'idle' | 'connecting' | 'ready' | 'closed';

export interface YjsBinding {
  readonly ydoc: Y.Doc;
  readonly roomId: string;
  readonly status: YjsBindingStatus;
  readonly destroy: () => void;
  /**
   * Subscribe to status transitions. Returns an unsubscribe handle.
   * The callback fires synchronously with the current status on
   * subscribe so consumers don't race the initial transition.
   */
  readonly onStatusChange: (cb: (status: YjsBindingStatus) => void) => () => void;
}

/**
 * Injectable Yjs provider factory — production wires `@liveblocks/yjs`;
 * tests pass a stub.
 */
export type YjsProviderFactory = (input: {
  readonly ydoc: Y.Doc;
  readonly client: unknown;
  readonly roomId: string;
}) => {
  readonly destroy: () => void;
  readonly on?: (event: 'sync', cb: (synced: boolean) => void) => void;
  readonly off?: (event: 'sync', cb: (synced: boolean) => void) => void;
};

let configuredProviderFactory: YjsProviderFactory | null = null;

export function configureYjsProvider(factory: YjsProviderFactory): void {
  configuredProviderFactory = factory;
}

/** Test-only — reset the provider factory between specs. */
export function __resetYjsProviderFactory(): void {
  configuredProviderFactory = null;
}

export interface CreateYjsBindingOptions {
  readonly room: LiveblocksRoom;
}

export function createYjsBinding(opts: CreateYjsBindingOptions): YjsBinding {
  const { room } = opts;
  if (!room?.client) {
    throw new Error('yjs-doc: room.client is required');
  }
  if (!configuredProviderFactory) {
    throw new Error(
      'yjs-doc: no Yjs provider configured. Call configureYjsProvider({...}) at portal bootstrap.',
    );
  }

  const ydoc = new Y.Doc();
  let status: YjsBindingStatus = 'connecting';
  const subscribers = new Set<(s: YjsBindingStatus) => void>();

  const setStatus = (next: YjsBindingStatus): void => {
    if (next === status) return;
    status = next;
    for (const cb of subscribers) {
      try {
        cb(status);
      } catch {
        // Status subscribers must not be able to crash the binding.
      }
    }
  };

  const provider = configuredProviderFactory({
    ydoc,
    client: room.client,
    roomId: room.roomId,
  });

  const onSync = (synced: boolean): void => {
    setStatus(synced ? 'ready' : 'connecting');
  };
  provider.on?.('sync', onSync);

  let destroyed = false;
  const destroy = (): void => {
    if (destroyed) return;
    destroyed = true;
    setStatus('closed');
    provider.off?.('sync', onSync);
    try {
      provider.destroy();
    } catch {
      // Ignore — already destroyed.
    }
    try {
      ydoc.destroy();
    } catch {
      // Y.Doc.destroy throws if already destroyed in some versions.
    }
    subscribers.clear();
  };

  return {
    ydoc,
    roomId: room.roomId,
    get status() {
      return status;
    },
    destroy,
    onStatusChange: (cb) => {
      subscribers.add(cb);
      try {
        cb(status);
      } catch {
        // Initial fire — never crash on subscribe.
      }
      return () => subscribers.delete(cb);
    },
  };
}

/**
 * Hook-factory — each portal's `realtime-rooms-client.ts` calls this
 * with its own `useState` / `useEffect` impls (React/Preact/etc.) so
 * we keep the shared package framework-agnostic.
 */
export interface ReactHookShim {
  readonly useState: <T>(initial: T) => [T, (next: T) => void];
  readonly useEffect: (fn: () => void | (() => void), deps?: unknown[]) => void;
}

export interface UseDocumentBindingResult {
  readonly ydoc: Y.Doc | null;
  readonly status: YjsBindingStatus;
}

export function useDocumentBindingFactory(react: ReactHookShim) {
  return function useDocumentBinding(
    binding: YjsBinding | null,
  ): UseDocumentBindingResult {
    const [status, setStatus] = react.useState<YjsBindingStatus>(
      binding?.status ?? 'idle',
    );
    react.useEffect(() => {
      if (!binding) {
        setStatus('idle');
        return undefined;
      }
      const unsub = binding.onStatusChange((s) => setStatus(s));
      return () => unsub();
    }, [binding]);
    return {
      ydoc: binding?.ydoc ?? null,
      status,
    };
  };
}
