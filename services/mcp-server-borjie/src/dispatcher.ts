/**
 * MCP method dispatcher — pure handler for incoming JSON-RPC requests.
 *
 * The dispatcher is transport-agnostic: stdio and HTTP both reduce to
 * "give me a JsonRpcRequest, I will give you a JsonRpcResponse". This
 * lets us share the same logic between the two transports and write
 * deterministic unit tests.
 */

import {
  BORJIE_PUBLIC_MCP_TOOLS,
  findPublicTool,
} from './tool-catalog.js';
import { BORJIE_PUBLIC_MCP_RESOURCES, findResource } from './resources.js';
import {
  BORJIE_PUBLIC_MCP_PROMPTS,
  findPrompt,
  renderPrompt,
} from './prompts.js';
import { hasRequiredScopes } from './scopes.js';
import {
  buildError,
  buildSuccess,
  JSON_RPC_FORBIDDEN,
  JSON_RPC_INTERNAL_ERROR,
  JSON_RPC_INVALID_PARAMS,
  JSON_RPC_KILL_SWITCH_OPEN,
  JSON_RPC_METHOD_NOT_FOUND,
  JSON_RPC_UNAUTHORIZED,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from './jsonrpc.js';
import { substitutePath, shapeRequest, TOOL_ROUTE_MAP } from './tool-router.js';
import type {
  BorjieMcpAuthContext,
  BorjieMcpToolContentBlock,
  BorjieMcpToolResult,
} from './types.js';
import type { GatewayClient } from './gateway-client.js';
import { GatewayError } from './gateway-client.js';

export interface DispatcherDeps {
  readonly gatewayClient: GatewayClient;
  readonly resolveAuthContext: (
    bearerToken: string | null,
  ) => Promise<BorjieMcpAuthContext | null>;
  readonly killSwitchOpen: () => Promise<boolean>;
  readonly now?: () => Date;
  readonly auditChainHash: (input: {
    readonly toolName: string;
    readonly auth: BorjieMcpAuthContext;
    readonly idempotencyKey?: string;
  }) => Promise<string>;
}

export interface DispatcherInput {
  readonly request: JsonRpcRequest;
  readonly bearerToken: string | null;
  readonly idempotencyKey?: string;
}

const PROTOCOL_VERSION = '2024-11-05';
const SERVER_NAME = 'borjie-mcp-server';
const SERVER_VERSION = '0.1.0';

export function createDispatcher(deps: DispatcherDeps) {
  const now = deps.now ?? (() => new Date());

  async function dispatch(input: DispatcherInput): Promise<JsonRpcResponse> {
    const { request, bearerToken, idempotencyKey } = input;
    const { id, method } = request;

    if (await deps.killSwitchOpen()) {
      return buildError(
        id,
        JSON_RPC_KILL_SWITCH_OPEN,
        'Borjie kill-switch is open — refusing all tool calls.',
      );
    }

    if (method === 'initialize') {
      return buildSuccess(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {
          tools: { listChanged: false },
          resources: { listChanged: false, subscribe: false },
          prompts: { listChanged: false },
        },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
      });
    }

    if (method === 'ping') {
      return buildSuccess(id, {});
    }

    if (method === 'tools/list') {
      return buildSuccess(id, {
        tools: BORJIE_PUBLIC_MCP_TOOLS.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        })),
      });
    }

    if (method === 'resources/list') {
      return buildSuccess(id, {
        resources: BORJIE_PUBLIC_MCP_RESOURCES.map((r) => ({
          uri: r.uri,
          name: r.name,
          description: r.description,
          mimeType: r.mimeType,
        })),
      });
    }

    if (method === 'prompts/list') {
      return buildSuccess(id, {
        prompts: BORJIE_PUBLIC_MCP_PROMPTS.map((p) => ({
          name: p.name,
          description: p.description,
          arguments: p.arguments,
        })),
      });
    }

    if (method === 'prompts/get') {
      const params = request.params ?? {};
      const name = params['name'];
      if (typeof name !== 'string') {
        return buildError(
          id,
          JSON_RPC_INVALID_PARAMS,
          'prompts/get requires `name`',
        );
      }
      const prompt = findPrompt(name);
      if (!prompt) {
        return buildError(id, JSON_RPC_METHOD_NOT_FOUND, `prompt: ${name}`);
      }
      const args = (params['arguments'] ?? {}) as Record<string, string>;
      const messages = renderPrompt(name, args);
      if (!messages) {
        return buildError(
          id,
          JSON_RPC_INTERNAL_ERROR,
          `prompt renderer missing for ${name}`,
        );
      }
      return buildSuccess(id, { description: prompt.description, messages });
    }

    if (method === 'resources/read') {
      const auth = await deps.resolveAuthContext(bearerToken);
      if (!auth) {
        return buildError(id, JSON_RPC_UNAUTHORIZED, 'authentication required');
      }
      const params = request.params ?? {};
      const uri = params['uri'];
      if (typeof uri !== 'string') {
        return buildError(
          id,
          JSON_RPC_INVALID_PARAMS,
          'resources/read requires `uri`',
        );
      }
      const resource = findResource(uri);
      if (!resource) {
        return buildError(id, JSON_RPC_METHOD_NOT_FOUND, `unknown resource: ${uri}`);
      }
      try {
        const data = await readResource(uri, deps.gatewayClient, auth);
        return buildSuccess(id, {
          contents: [
            {
              uri,
              mimeType: resource.mimeType,
              text: JSON.stringify(data),
            },
          ],
        });
      } catch (err) {
        return resourceErrorToRpc(id, err);
      }
    }

    if (method === 'tools/call') {
      const auth = await deps.resolveAuthContext(bearerToken);
      if (!auth) {
        return buildError(id, JSON_RPC_UNAUTHORIZED, 'authentication required');
      }
      const params = request.params ?? {};
      const name = params['name'];
      if (typeof name !== 'string') {
        return buildError(
          id,
          JSON_RPC_INVALID_PARAMS,
          'tools/call requires `name`',
        );
      }
      const tool = findPublicTool(name);
      if (!tool) {
        return buildError(id, JSON_RPC_METHOD_NOT_FOUND, `unknown tool: ${name}`);
      }
      if (!hasRequiredScopes(auth.scopes, tool.requiredScopes)) {
        return buildError(
          id,
          JSON_RPC_FORBIDDEN,
          `scope required: ${tool.requiredScopes.join(', ')}`,
        );
      }

      const args = (params['arguments'] ?? {}) as Record<string, unknown>;
      const route = TOOL_ROUTE_MAP[name];
      if (!route) {
        return buildError(
          id,
          JSON_RPC_INTERNAL_ERROR,
          `route not registered for ${name}`,
        );
      }

      let path: string;
      try {
        path = substitutePath(route.path, args);
      } catch (err) {
        return buildError(
          id,
          JSON_RPC_INVALID_PARAMS,
          err instanceof Error ? err.message : 'invalid path params',
        );
      }
      const shaped = shapeRequest(route, args);

      try {
        const upstream = await deps.gatewayClient.call({
          path,
          method: route.method,
          accessToken: bearerToken ?? '',
          agentTokenId: auth.agentTokenId,
          mcpToolName: name,
          ...(shaped.body !== undefined ? { body: shaped.body } : {}),
          ...(shaped.query !== undefined ? { query: shaped.query } : {}),
          ...(idempotencyKey !== undefined ? { idempotencyKey } : {}),
        });
        const auditHash = await deps.auditChainHash({
          toolName: name,
          auth,
          ...(idempotencyKey !== undefined ? { idempotencyKey } : {}),
        });
        const result: BorjieMcpToolResult = {
          ok: true,
          content: shapeContent(upstream),
          confidence: pickConfidence(upstream),
          evidenceIds: pickEvidenceIds(upstream),
          provenance: {
            via: 'mcp',
            agentName: auth.agentName,
            agentTokenId: auth.agentTokenId,
            toolName: name,
            invokedAt: now().toISOString(),
            auditChainHash: auditHash,
          },
          requiresConfirmation: tool.requiresConfirmation,
        };
        return buildSuccess(id, result);
      } catch (err) {
        return toolErrorToRpc(id, err);
      }
    }

    return buildError(id, JSON_RPC_METHOD_NOT_FOUND, `unknown method: ${method}`);
  }

  return Object.freeze({ dispatch });
}

function shapeContent(upstream: unknown): ReadonlyArray<BorjieMcpToolContentBlock> {
  if (upstream && typeof upstream === 'object') {
    const o = upstream as Record<string, unknown>;
    if (typeof o['text'] === 'string') {
      return Object.freeze([
        Object.freeze({ type: 'text' as const, text: o['text'] }),
      ]);
    }
  }
  return Object.freeze([
    Object.freeze({ type: 'json' as const, data: upstream }),
  ]);
}

function pickConfidence(upstream: unknown): number {
  if (upstream && typeof upstream === 'object') {
    const o = upstream as Record<string, unknown>;
    const c = o['confidence'];
    if (typeof c === 'number' && Number.isFinite(c)) return c;
  }
  return 0.75;
}

function pickEvidenceIds(upstream: unknown): ReadonlyArray<string> {
  if (upstream && typeof upstream === 'object') {
    const o = upstream as Record<string, unknown>;
    const e = o['evidenceIds'];
    if (Array.isArray(e)) {
      return Object.freeze(e.filter((v): v is string => typeof v === 'string'));
    }
  }
  return Object.freeze([]);
}

async function readResource(
  uri: string,
  client: GatewayClient,
  auth: BorjieMcpAuthContext,
): Promise<unknown> {
  const path = mapResourceUriToPath(uri);
  return client.call({
    path,
    method: 'GET',
    accessToken: '',
    agentTokenId: auth.agentTokenId,
    mcpToolName: `resource:${uri}`,
  });
}

function mapResourceUriToPath(uri: string): string {
  switch (uri) {
    case 'borjie://capabilities':
      return '/.well-known/borjie-capabilities.json';
    case 'borjie://estate/entities':
      return '/api/v1/entities/summary';
    case 'borjie://decisions/recent':
      return '/api/v1/decisions?limit=50';
    case 'borjie://calibration/current':
      return '/api/v1/mining/calibration/status';
    case 'borjie://corpus/mining/index':
      return '/api/v1/intelligence/corpus/index';
    case 'borjie://compliance/posture':
      return '/api/v1/compliance/status';
    case 'borjie://memory/advisor':
      return '/api/v1/owner/memory/advisor';
    default:
      throw new Error(`no path mapping for resource ${uri}`);
  }
}

function toolErrorToRpc(
  id: string | number | null,
  err: unknown,
): JsonRpcResponse {
  if (err instanceof GatewayError) {
    if (err.status === 401) return buildError(id, JSON_RPC_UNAUTHORIZED, err.message);
    if (err.status === 403) return buildError(id, JSON_RPC_FORBIDDEN, err.message);
    if (err.status === 422) return buildError(id, JSON_RPC_INVALID_PARAMS, err.message);
    return buildError(id, JSON_RPC_INTERNAL_ERROR, err.message, {
      status: err.status,
      code: err.code,
    });
  }
  const message = err instanceof Error ? err.message : 'unknown error';
  return buildError(id, JSON_RPC_INTERNAL_ERROR, message);
}

function resourceErrorToRpc(
  id: string | number | null,
  err: unknown,
): JsonRpcResponse {
  return toolErrorToRpc(id, err);
}
