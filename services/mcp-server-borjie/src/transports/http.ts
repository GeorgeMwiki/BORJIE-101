/**
 * Minimal HTTP transport for the public MCP server.
 *
 * Surface:
 *   - POST /mcp        — JSON-RPC body, returns one JSON-RPC response.
 *   - GET  /healthz    — liveness.
 *   - GET  /readyz     — readiness (delegates to deps.killSwitchOpen()).
 *
 * We do not depend on Hono / Express here so the package stays tiny.
 * The api-gateway mounts this transport behind its own CORS / auth /
 * rate-limit middleware via a `mcp.hono.ts` adapter.
 */

import type { JsonRpcResponse } from '../jsonrpc.js';
import {
  buildError,
  parseJsonRpcLine,
  JSON_RPC_PARSE_ERROR,
  JSON_RPC_INVALID_REQUEST,
} from '../jsonrpc.js';
import { createDispatcher, type DispatcherDeps } from '../dispatcher.js';

export interface HttpHandlerDeps extends DispatcherDeps {}

export interface HttpRequestLike {
  readonly method: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string | undefined>>;
  readonly body: string;
}

export interface HttpResponseLike {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

const JSON_HEADERS = Object.freeze({ 'content-type': 'application/json' });

export function createHttpHandler(deps: HttpHandlerDeps) {
  const dispatcher = createDispatcher(deps);

  return async function handle(req: HttpRequestLike): Promise<HttpResponseLike> {
    const url = new URL(req.url, 'http://internal/');
    const path = url.pathname;

    if (req.method === 'GET' && path === '/healthz') {
      return Object.freeze({
        status: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify({ ok: true }),
      });
    }
    if (req.method === 'GET' && path === '/readyz') {
      const killed = await deps.killSwitchOpen();
      return Object.freeze({
        status: killed ? 503 : 200,
        headers: JSON_HEADERS,
        body: JSON.stringify({ killSwitchOpen: killed }),
      });
    }
    if (req.method !== 'POST' || path !== '/mcp') {
      return Object.freeze({
        status: 404,
        headers: JSON_HEADERS,
        body: JSON.stringify({ error: 'not found' }),
      });
    }

    const parsed = parseJsonRpcLine(req.body);
    if (!parsed) {
      return jsonRpc(buildError(null, JSON_RPC_PARSE_ERROR, 'invalid JSON or JSON-RPC envelope'));
    }
    if (typeof parsed.method !== 'string') {
      return jsonRpc(buildError(parsed.id, JSON_RPC_INVALID_REQUEST, 'missing method'));
    }

    const bearerToken = pickBearer(req.headers);
    const idempotencyKey = req.headers['idempotency-key'];

    const response = await dispatcher.dispatch({
      request: parsed,
      bearerToken,
      ...(typeof idempotencyKey === 'string' ? { idempotencyKey } : {}),
    });
    return jsonRpc(response);
  };
}

function jsonRpc(response: JsonRpcResponse): HttpResponseLike {
  return Object.freeze({
    status: 200,
    headers: JSON_HEADERS,
    body: JSON.stringify(response),
  });
}

function pickBearer(
  headers: Readonly<Record<string, string | undefined>>,
): string | null {
  const a = headers['authorization'] ?? headers['Authorization'];
  if (typeof a !== 'string') return null;
  const m = /^Bearer\s+(.+)$/i.exec(a);
  return m && m[1] ? m[1] : null;
}
