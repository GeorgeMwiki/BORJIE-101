/**
 * Unit tests for the brain-voice WS transport wiring
 * (composition/voice/voice-wiring.ts).
 *
 * No network, no real provider key, no `ws` socket upgrade. We verify the
 * WIRING LOGIC:
 *   • createVoiceWiring attaches when a factory is built (attached:true) and
 *     passes the live server + voice path through to the factory.
 *   • createVoiceWiring degrades safely when the factory builder returns
 *     undefined (ws unavailable → attach no-ops) → attached:false, no throw.
 *   • createVoiceWiring swallows a throwing builder → attached:false, no throw.
 *   • the real `ws`-backed buildVoiceWebSocketServerFactory registers an
 *     'upgrade' handler and path-gates it (only the voice pathname is handled;
 *     other paths leave the socket untouched).
 *
 * No console.log, no mutation across tests.
 */

import { EventEmitter } from 'node:events';
import type { Server as HttpServer } from 'node:http';

import { describe, it, expect, vi } from 'vitest';

import {
  createVoiceWiring,
  buildVoiceWebSocketServerFactory,
} from '../voice/voice-wiring.js';
import type {
  WebSocketServerLike,
  ClientSocketLike,
} from '../../routes/brain-voice.hono.js';

const VOICE_WS_PATH = '/api/v1/brain/voice/stream';

/** A fake HTTP server — just the `'upgrade'` event surface the factory uses. */
function fakeHttpServer(): HttpServer & EventEmitter {
  return new EventEmitter() as unknown as HttpServer & EventEmitter;
}

describe('createVoiceWiring', () => {
  it('attaches when the builder returns a factory, threading server + voice path', () => {
    const server = fakeHttpServer();
    let seen: { server: unknown; path: string } | null = null;

    // A fake transport factory: records what attach hands it. Returning a
    // function (not undefined) is the "ws available" path.
    const factory: WebSocketServerLike = ({ server: s, path, onConnection }) => {
      // Touch onConnection so the param is exercised without a real socket.
      void onConnection;
      seen = { server: s, path };
    };

    const result = createVoiceWiring({ server, buildFactory: () => factory });

    expect(result.attached).toBe(true);
    // attach invoked the factory with the live server + the canonical path.
    expect(seen).not.toBeNull();
    expect(seen!.server).toBe(server);
    expect(seen!.path).toBe(VOICE_WS_PATH);
  });

  it('forwards an accepted connection through to a VoiceSession (emit path live)', () => {
    const server = fakeHttpServer();
    let capturedOnConnection:
      | ((socket: ClientSocketLike, query: URLSearchParams) => void)
      | null = null;

    const factory: WebSocketServerLike = ({ onConnection }) => {
      capturedOnConnection = onConnection;
    };

    const result = createVoiceWiring({ server, buildFactory: () => factory });
    expect(result.attached).toBe(true);
    expect(capturedOnConnection).toBeInstanceOf(Function);

    // Simulate a socket the transport accepted. With no `?token`, the session
    // waits for an auth frame; sending audio first must elicit a serialized
    // `not_authenticated` error frame back over the socket (proves the bridge
    // is wired end-to-end through the injected factory, not a stub).
    const sent: string[] = [];
    const listeners: Record<string, (arg?: unknown) => void> = {};
    const socket: ClientSocketLike = {
      send: (d) => sent.push(d),
      close: () => undefined,
      on: (event, listener) => {
        listeners[event] = listener;
      },
    };

    capturedOnConnection!(socket, new URLSearchParams());
    // Drive an inbound audio frame before auth.
    listeners.message?.(
      Buffer.from(
        JSON.stringify({ type: 'audio', base64: Buffer.from([1]).toString('base64') }),
      ),
    );

    expect(sent.some((s) => s.includes('not_authenticated'))).toBe(true);
  });

  it('degrades safely when the builder returns undefined (ws unavailable)', () => {
    const server = fakeHttpServer();
    const upgradeListenersBefore = server.listenerCount('upgrade');

    const result = createVoiceWiring({ server, buildFactory: () => undefined });

    // attach took its no-op + warn path: no live transport, boot continues.
    expect(result.attached).toBe(false);
    // No `'upgrade'` handler was registered (the real factory was never built).
    expect(server.listenerCount('upgrade')).toBe(upgradeListenersBefore);
  });

  it('swallows a throwing builder and never crashes boot', () => {
    const server = fakeHttpServer();
    const boom = vi.fn(() => {
      throw new Error('ws blew up');
    });

    let result: { attached: boolean } | undefined;
    expect(() => {
      result = createVoiceWiring({ server, buildFactory: boom });
    }).not.toThrow();
    expect(result?.attached).toBe(false);
    expect(boom).toHaveBeenCalledTimes(1);
  });
});

describe('buildVoiceWebSocketServerFactory (real ws transport)', () => {
  it('registers an upgrade handler and path-gates to the voice pathname', () => {
    const factory = buildVoiceWebSocketServerFactory();
    // `ws` is a declared dependency, so the factory must build.
    expect(factory).toBeInstanceOf(Function);

    const server = fakeHttpServer();
    const accepted: ClientSocketLike[] = [];
    factory!({
      server,
      path: VOICE_WS_PATH,
      onConnection: (socket) => accepted.push(socket),
    });

    // An 'upgrade' listener is now hooked onto the HTTP server.
    expect(server.listenerCount('upgrade')).toBe(1);

    // A non-matching path must be ignored — the socket is left untouched
    // (handleUpgrade is never reached, so onConnection never fires).
    const fakeSocket = { destroyed: false } as unknown;
    server.emit(
      'upgrade',
      { url: '/some/other/path' },
      fakeSocket,
      Buffer.alloc(0),
    );
    expect(accepted).toHaveLength(0);

    // A malformed upgrade target is tolerated (no throw, still no connection).
    expect(() =>
      server.emit('upgrade', { url: undefined }, fakeSocket, Buffer.alloc(0)),
    ).not.toThrow();
    expect(accepted).toHaveLength(0);
  });
});
