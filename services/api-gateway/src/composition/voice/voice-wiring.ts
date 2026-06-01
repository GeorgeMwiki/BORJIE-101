/**
 * Brain-voice WS transport wiring — the injectable seam that turns the
 * realtime-voice BACKEND (routes/brain-voice.hono.ts) from INACTIVE into LIVE.
 *
 * The route file is deliberately `ws`-type-free: `attachBrainVoiceWebSocket`
 * accepts an injected `webSocketServerFactory` and NO-OPs (with a Pino warning)
 * until one is supplied. This module is that supplier. It:
 *
 *   1. Builds a real `WebSocketServerLike` factory backed by the `ws` package's
 *      `WebSocketServer` in `noServer` mode, hooked onto the gateway's Express
 *      HTTP server `'upgrade'` event and gated to the exact voice pathname.
 *   2. Calls `attachBrainVoiceWebSocket({ server, webSocketServerFactory })` so
 *      every accepted socket gets its own `VoiceSession`.
 *
 * Once attached, NOTHING about the bridge changes: each tool-call still runs
 * through `gateAndExecuteVoiceAction` → the fail-closed authorization gate →
 * the typed action-executor inside a transaction whose `app.current_tenant_id`
 * GUC is bound with `SET LOCAL`; confirm-required verbs still demand the
 * single-use, tenant+user-bound, TTL'd spoken-confirmation token round-trip;
 * money/draft verbs never touch the ledger. This file only provides transport.
 *
 * The orchestrator (services/api-gateway/src/index.ts) mounts this AFTER
 * `app.listen(...)` by calling `createVoiceWiring({ server })`. It is NOT
 * called from here, and this module never reads `process.env` or touches any
 * other feature — it is a pure transport seam.
 *
 * No console.log — Pino only. Fail-soft: a missing/broken `ws` module or any
 * attach error is logged and swallowed so gateway boot is never affected.
 */

import type { Server as HttpServer } from 'node:http';

import pino from 'pino';

import {
  attachBrainVoiceWebSocket,
  type WebSocketServerLike,
  type ClientSocketLike,
} from '../../routes/brain-voice.hono.js';

const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  name: 'voice-wiring',
});

/**
 * Build the `ws`-backed WS-upgrade transport for the brain-voice endpoint,
 * conforming to the `WebSocketServerLike` contract in brain-voice.hono.ts.
 *
 * Uses a `noServer`-mode `WebSocketServer` hooked onto the Express HTTP
 * server's `'upgrade'` event, gated to the exact voice pathname (other paths
 * are left untouched so any future WS routes coexist). Each accepted `ws`
 * socket is adapted to `ClientSocketLike` (the `ws` API already matches the
 * `send` / `close` / `on('message'|'close'|'error')` shapes).
 *
 * Returns `undefined` — so `attachBrainVoiceWebSocket` takes its safe no-op +
 * warn path and boot stays clean — when `ws` cannot be loaded (e.g. an install
 * is pending) rather than throwing.
 */
export function buildVoiceWebSocketServerFactory(): WebSocketServerLike | undefined {
  let WebSocketServerCtor: typeof import('ws').WebSocketServer;
  try {
    // Lazy require (mirrors the inline-require pattern used elsewhere in the
    // gateway, e.g. composition/mcp-wiring.ts) so a missing/broken `ws` module
    // can never crash module load — the voice channel degrades, boot does not.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    WebSocketServerCtor = (require('ws') as typeof import('ws')).WebSocketServer;
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'brain-voice: `ws` module unavailable — voice WS transport not built (endpoint inactive)',
    );
    return undefined;
  }

  return ({ server: httpServer, path, onConnection }) => {
    const wss = new WebSocketServerCtor({ noServer: true });

    httpServer.on('upgrade', (request, socket, head) => {
      let pathname: string;
      try {
        pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
      } catch {
        return; // malformed upgrade target — leave for other handlers
      }
      if (pathname !== path) return; // not ours — do not touch the socket

      wss.handleUpgrade(request, socket, head, (rawSocket) => {
        const query = (() => {
          try {
            return new URL(request.url ?? '/', 'http://localhost').searchParams;
          } catch {
            return new URLSearchParams();
          }
        })();
        // `ws.WebSocket` already satisfies the ClientSocketLike surface
        // (send/close/on). Cast through the shared type so the conformance
        // is explicit and checked at the boundary.
        onConnection(rawSocket as unknown as ClientSocketLike, query);
      });
    });

    wss.on('error', (err: Error) => {
      logger.warn(
        { err: err.message, path },
        'brain-voice: WebSocketServer error (voice transport degraded)',
      );
    });
  };
}

/** Inputs for {@link createVoiceWiring}. */
export interface CreateVoiceWiringDeps {
  /**
   * The live Express HTTP server returned by `app.listen(...)`. The voice
   * endpoint is a WS-upgrade on this server, not a Hono route, so it must be
   * mounted after the server is listening.
   */
  readonly server: HttpServer;
  /**
   * Override the transport factory builder (tests inject a fake so the
   * `ws`-less, network-less wiring path is exercised). Defaults to the real
   * `ws`-backed {@link buildVoiceWebSocketServerFactory}.
   */
  readonly buildFactory?: () => WebSocketServerLike | undefined;
}

/** Outcome of a {@link createVoiceWiring} call (observable for tests + probes). */
export interface VoiceWiringResult {
  /**
   * `true` when a real `ws`-backed transport was built and the endpoint went
   * live; `false` when `ws` was unavailable (attach took its no-op path) or the
   * attach threw (gateway boot continues either way).
   */
  readonly attached: boolean;
}

/**
 * Mount the brain-voice realtime WS endpoint on the gateway's HTTP server.
 *
 * Builds the `ws`-backed upgrade transport and passes it to
 * `attachBrainVoiceWebSocket` as `webSocketServerFactory`; if `ws` is
 * unavailable the factory is `undefined` and attach falls back to its safe
 * no-op + warn. Wrapped so a wiring bug in the voice channel can never crash
 * gateway boot.
 *
 * Call this from the orchestrator's `app.listen(...)` callback:
 *
 * ```ts
 * server = app.listen(port, () => { ... });
 * createVoiceWiring({ server });
 * ```
 *
 * @returns whether the live transport was attached.
 */
export function createVoiceWiring(deps: CreateVoiceWiringDeps): VoiceWiringResult {
  const build = deps.buildFactory ?? buildVoiceWebSocketServerFactory;
  try {
    const voiceWsFactory = build();
    attachBrainVoiceWebSocket({
      server: deps.server,
      // Conditional spread honours exactOptionalPropertyTypes: omit the key
      // entirely (rather than passing `undefined`) so attach takes its safe
      // no-op + warn path when `ws` is unavailable.
      ...(voiceWsFactory ? { webSocketServerFactory: voiceWsFactory } : {}),
    });
    return { attached: voiceWsFactory !== undefined };
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'brain-voice: attach failed (voice channel disabled, gateway continues)',
    );
    return { attached: false };
  }
}
