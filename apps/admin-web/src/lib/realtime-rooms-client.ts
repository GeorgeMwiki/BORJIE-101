/**
 * Realtime-rooms client (Admin Platform Portal) — Central Command Phase B B6.
 *
 * Thin wrapper around `@borjie/realtime-rooms` that:
 *   1. Lazily loads `@liveblocks/client` so SSR-only paths don't pull
 *      the SDK into the server bundle.
 *   2. Wires the auth endpoint to `/api/v1/realtime/auth` (the gateway
 *      mints session tokens scoped to the caller's tenantId).
 *   3. Exposes a `useRoom(roomId)` hook for components to consume.
 *
 * Identical bodies exist in the other three portals:
 *   - apps/admin-web/src/lib/realtime-rooms-client.ts (this)
 *   - apps/owner-portal/src/lib/realtime-rooms-client.ts
 *   - apps/customer-app/src/lib/realtime-rooms-client.ts
 *   - apps/estate-manager-app/src/lib/realtime-rooms-client.ts
 *
 * Follow-up B6 follow-up (Docs/TODO_BACKLOG.md): extract to `packages/realtime-rooms-client/`
 * when a portal needs to override the auth dispatch (e.g. a
 * tenant-portal that proxies through a custom domain).
 */

import {
  configureLiveblocksFactory,
  configureYjsProvider,
  createLiveblocksRoom,
  type LiveblocksRoom,
  type CreateLiveblocksRoomOptions,
} from '@borjie/realtime-rooms';

const AUTH_ENDPOINT = '/api/v1/realtime/auth';

/**
 * Bootstrap the Liveblocks + Yjs adapters. Call ONCE at app start
 * (the root layout). Idempotent — safe to call multiple times.
 */
let bootstrapped = false;
export async function bootstrapRealtimeRooms(): Promise<void> {
  if (bootstrapped) return;
  // Dynamic import keeps the SDK out of the server bundle until
  // we're sure we're on the client.
  if (typeof window === 'undefined') return;

  try {
    const liveblocks: any = await import(
      /* webpackIgnore: true */ /* @vite-ignore */ '@liveblocks/client'
    );
    configureLiveblocksFactory(({ authEndpoint }) => {
      const client = liveblocks.createClient({
        authEndpoint: async (room: string) => {
          const res = await fetch(authEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
              rooms: [{ id: room, access: 'FULL' }],
            }),
          });
          if (!res.ok) {
            throw new Error(
              `realtime-rooms: auth endpoint returned ${res.status}`,
            );
          }
          const json = await res.json();
          return json.data ?? json;
        },
      });
      return {
        enterRoom: (roomId: string, opts?: unknown) =>
          client.enter(roomId, opts as never),
        leave: (roomId: string) => client.leave(roomId),
      };
    });

    interface LiveblocksClientLike {
      readonly getRoom?: (roomId: string) => unknown;
    }
    interface LiveblocksYjsModule {
      readonly LiveblocksYjsProvider: new (
        room: unknown,
        ydoc: unknown,
      ) => {
        destroy(): void;
        on(event: 'sync', cb: (synced: boolean) => void): void;
        off(event: 'sync', cb: (synced: boolean) => void): void;
      };
    }
    const yjs = (await import(
      /* webpackIgnore: true */ /* @vite-ignore */ '@liveblocks/yjs'
    )) as unknown as LiveblocksYjsModule;
    configureYjsProvider(({ ydoc, client, roomId }) => {
      const room = (client as LiveblocksClientLike).getRoom?.(roomId);
      const provider = new yjs.LiveblocksYjsProvider(room, ydoc);
      return {
        destroy: () => provider.destroy(),
        on: (event: 'sync', cb: (synced: boolean) => void) =>
          provider.on(event, cb),
        off: (event: 'sync', cb: (synced: boolean) => void) =>
          provider.off(event, cb),
      };
    });

    bootstrapped = true;
  } catch (err) {
    // Don't crash the surface when the SDK isn't installed yet —
    // collaborative editing degrades gracefully (consumers see no
    // CRDT updates but other state-sync paths keep working).
  }
}

export interface UseRoomOptions
  extends Pick<CreateLiveblocksRoomOptions, 'userInfo'> {
  readonly roomId: string;
}

/**
 * `useRoom` factory — components import this and pass it to React
 * runtimes. We don't import React here so this file stays consumable
 * from both the App Router server and client trees.
 */
export function openRoom(opts: UseRoomOptions): LiveblocksRoom {
  return createLiveblocksRoom({
    roomId: opts.roomId,
    authEndpoint: AUTH_ENDPOINT,
    userInfo: opts.userInfo,
  });
}
