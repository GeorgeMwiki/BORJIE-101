/**
 * MCP Router — mounts `@borjie/mcp-server` at `/api/v1/mcp`.
 *
 * Transport: JSON-RPC 2.0 over HTTP POST. An SDK-native SSE transport
 * (from `@modelcontextprotocol/sdk`) can be layered on top without
 * changing this module — the heavy-lifting (auth, tier, cost, tool
 * dispatch) lives in the package.
 *
 * Endpoints:
 *   POST /api/v1/mcp               — JSON-RPC 2.0 (initialize, tools/list,
 *                                    tools/call, resources/list, resources/read)
 *   GET  /api/v1/mcp/manifest      — human-friendly server manifest
 *   GET  /.well-known/agent.json   — A2A Agent Card
 *
 * NOTE: This router expects the composition root to have built a
 * `BossnyumbaMcpServer` via `buildMcpServer()` and attached it to the
 * Hono context as `services.mcp`. Until wired, the router returns
 * 503 Not Implemented.
 */

import { Hono } from 'hono';
import type {
  BossnyumbaMcpServer,
  McpAuthContext,
} from '@borjie/mcp-server';
import { getPrompt, listPrompts } from '@borjie/mcp-server';
import { generateAgentCard } from '@borjie/agent-platform';

import { withSecurityEvents } from '@borjie/observability';
interface JsonRpcRequest {
  readonly jsonrpc: '2.0';
  readonly id: number | string | null;
  readonly method: string;
  readonly params?: Record<string, unknown>;
}

interface JsonRpcSuccess {
  readonly jsonrpc: '2.0';
  readonly id: number | string | null;
  readonly result: unknown;
}

interface JsonRpcError {
  readonly jsonrpc: '2.0';
  readonly id: number | string | null;
  readonly error: {
    readonly code: number;
    readonly message: string;
    readonly data?: unknown;
  };
}

type JsonRpcResponse = JsonRpcSuccess | JsonRpcError;

function rpcError(
  id: number | string | null,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcError {
  return {
    jsonrpc: '2.0',
    id,
    error: { code, message, ...(data !== undefined ? { data } : {}) },
  };
}

function rpcOk(id: number | string | null, result: unknown): JsonRpcSuccess {
  return { jsonrpc: '2.0', id, result };
}

const app = new Hono();

function getMcp(c: any): BossnyumbaMcpServer | null {
  const services = c.get('services') ?? {};
  return services.mcp ?? null;
}

async function authenticate(
  c: any,
  mcp: BossnyumbaMcpServer,
): Promise<McpAuthContext | null> {
  const headers: Record<string, string | undefined> = {};
  // Hono's header accessor
  const raw = c.req.header() as Record<string, string | undefined>;
  for (const [k, v] of Object.entries(raw)) {
    headers[k.toLowerCase()] = v;
  }
  const res = await mcp.auth.authenticate({ headers });
  if ('ok' in res && res.ok === false) return null;
  return res as McpAuthContext;
}

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

app.get('/manifest', (c: any) => {
  const mcp = getMcp(c);
  if (!mcp) {
    return c.json(
      {
        success: false,
        error: { code: 'NOT_IMPLEMENTED', message: 'MCP server not wired' },
      },
      503,
    );
  }
  return c.json({
    success: true,
    data: {
      name: mcp.config.name,
      version: mcp.config.version,
      description: mcp.config.description,
      tools: mcp.tools.map((t) => ({
        name: t.name,
        description: t.description,
        minimumTier: t.minimumTier,
        requiredScopes: t.requiredScopes,
      })),
      resources: mcp.staticResources.map((r) => ({
        uri: r.uri,
        name: r.name,
      })),
    },
  });
});

// ---------------------------------------------------------------------------
// JSON-RPC entrypoint
// ---------------------------------------------------------------------------

app.post('/', withSecurityEvents({ action: 'mcp.create', resource: 'mcp', severity: 'info' }, async (c: any) => {
  const mcp = getMcp(c);
  if (!mcp) {
    return c.json(
      {
        success: false,
        error: { code: 'NOT_IMPLEMENTED', message: 'MCP server not wired' },
      },
      503,
    );
  }

  let body: JsonRpcRequest;
  try {
    body = (await c.req.json()) as JsonRpcRequest;
  } catch {
    const err = rpcError(null, -32700, 'Parse error');
    return c.json(err, 400);
  }

  if (body.jsonrpc !== '2.0' || typeof body.method !== 'string') {
    const err = rpcError(body.id ?? null, -32600, 'Invalid Request');
    return c.json(err, 400);
  }

  const context = await authenticate(c, mcp);
  if (!context) {
    const err = rpcError(body.id ?? null, -32001, 'Authentication required');
    return c.json(err, 401);
  }

  let response: JsonRpcResponse;
  try {
    switch (body.method) {
      case 'initialize':
        response = rpcOk(body.id, {
          protocolVersion: '2024-11-05',
          serverInfo: {
            name: mcp.config.name,
            version: mcp.config.version,
          },
          capabilities: { tools: {}, resources: {}, prompts: {} },
        });
        break;
      case 'tools/list':
        response = rpcOk(body.id, {
          tools: mcp.tools.map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: {
              type: 'object',
              properties: t.inputSchema,
              required: t.requiredInputs,
            },
          })),
        });
        break;
      case 'tools/call': {
        const name = (body.params?.name ?? '') as string;
        const args = (body.params?.arguments ?? {}) as Record<
          string,
          unknown
        >;
        const out = await mcp.invokeTool(name, args, context);
        const res = out.result;
        if (res.ok === true) {
          response = rpcOk(body.id, {
            content: [
              {
                type: 'text',
                text: JSON.stringify(res.data, null, 2),
              },
            ],
          });
        } else {
          response = rpcError(body.id, -32000, res.error, {
            errorCode: res.errorCode,
          });
        }
        break;
      }
      case 'resources/list':
        response = rpcOk(body.id, {
          resources: mcp.staticResources.map((r) => ({
            uri: r.uri,
            name: r.name,
            description: r.description,
            mimeType: r.mimeType,
          })),
        });
        break;
      case 'resources/read': {
        const uri = (body.params?.uri ?? '') as string;
        const text = await mcp.readStaticResource(uri, context);
        response = rpcOk(body.id, {
          contents: [
            { uri, mimeType: 'application/json', text },
          ],
        });
        break;
      }
      case 'prompts/list': {
        // Tier-and-scope filtered — callers only see prompts they can
        // actually invoke. Mirrors LITFIN's MCP `prompts/list` semantics
        // and matches the `prompts: {}` capability advertised in
        // `initialize` above.
        const result = listPrompts(context);
        response = rpcOk(body.id, result);
        break;
      }
      case 'prompts/get': {
        const name = (body.params?.name ?? '') as string;
        const rawArgs = (body.params?.arguments ?? {}) as Record<
          string,
          unknown
        >;
        // Coerce arg values to strings — `getPrompt` renders into text
        // and treats missing / empty values as absent.
        const args: Record<string, string> = {};
        for (const [k, v] of Object.entries(rawArgs)) {
          args[k] = typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v);
        }
        const outcome = getPrompt(name, args, context);
        if (outcome.ok === true) {
          response = rpcOk(body.id, outcome.result);
        } else {
          // Map discriminated-union errorCodes onto JSON-RPC error codes:
          //   PROMPT_NOT_FOUND      → -32601 (method not found)
          //   TIER_INSUFFICIENT     → -32602 (invalid params — caller's
          //                                   tier does not satisfy
          //                                   the prompt's policy)
          //   SCOPE_INSUFFICIENT    → -32602 (invalid params)
          //   ARGUMENT_MISSING      → -32602 (invalid params)
          const rpcCode =
            outcome.errorCode === 'PROMPT_NOT_FOUND' ? -32601 : -32602;
          response = rpcError(body.id, rpcCode, outcome.error, {
            errorCode: outcome.errorCode,
          });
        }
        break;
      }
      default:
        response = rpcError(body.id, -32601, `Method not found: ${body.method}`);
    }
  } catch (err) {
    response = rpcError(
      body.id,
      -32603,
      err instanceof Error ? err.message : 'Internal error',
    );
  }

  const status = 'error' in response ? 200 : 200; // JSON-RPC uses 200
  return c.json(response, status);
}));

// ---------------------------------------------------------------------------
// Agent Card (A2A)
// ---------------------------------------------------------------------------

export const agentCardRouter = new Hono();
agentCardRouter.get('/', (c: any) => {
  const mcp = getMcp(c);
  // Prefer the proxy-forwarded host so A2A clients see the correct canonical
  // URL, fall back to PUBLIC_BASE_URL env, and only then to localhost for dev.
  const forwardedHost = c.req.header('x-forwarded-host');
  const envBase = process.env.PUBLIC_BASE_URL?.trim();
  const baseUrl = forwardedHost
    ? `https://${forwardedHost}`
    : envBase && envBase.length > 0
      ? envBase
      : 'http://localhost:3000';
  if (!mcp) {
    return c.json(
      generateAgentCard({ baseUrl, tools: [], resources: [] }),
    );
  }
  const card = generateAgentCard({
    baseUrl,
    tools: mcp.tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema as unknown as Record<string, unknown>,
      requiredScopes: t.requiredScopes,
      category: 'property-management',
    })),
    resources: mcp.staticResources.map((r) => ({
      uri: r.uri,
      name: r.name,
      description: r.description,
      mimeType: r.mimeType,
    })),
  });
  return c.json(card);
});

export default app;
