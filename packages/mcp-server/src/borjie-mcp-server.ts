/**
 * BORJIE MCP Server
 *
 * Top-level factory that wires:
 *   - the declarative tool registry (`tool-registry.ts`)
 *   - injected tool handlers (from the api-gateway composition root)
 *   - tenant-scoped auth (`mcp-auth.ts`)
 *   - tier gating (`tier-router.ts`)
 *   - cost persistence (`cost-persistence.ts`)
 *   - static + template resources (`mcp-resources.ts`)
 *
 * The factory returns a lightweight `BossnyumbaMcpServer` value object
 * rather than directly constructing `@modelcontextprotocol/sdk`'s
 * `McpServer`. This lets the gateway decide which transport to attach
 * (SSE for HTTP, stdio for Claude-Desktop compatibility), and lets us
 * unit-test the dispatcher without spinning up a real SDK server.
 *
 * A companion helper `attachToMcpServer(server, borjie)` performs the
 * actual `server.tool(...)` / `server.resource(...)` registrations against
 * an SDK `McpServer` instance at composition time.
 */

import type {
  McpServerConfig,
  McpAuthContext,
  McpToolDefinition,
  McpToolHandler,
  McpCostEntry,
  McpCostSnapshot,
} from './types.js';
import { BORJIE_TOOLS, findToolDefinition } from './tool-registry.js';
import {
  wrapToolHandler,
  createRunSkillHandler,
  type WrappedToolInvocation,
} from './universal-tool-adapter.js';
import { createTierRouter, type TierRouter } from './tier-router.js';
import {
  createCostBatcher,
  createInMemoryCostLedger,
  type CostBatcher,
} from './cost-persistence.js';
import type { CostLedgerPort } from './types.js';
import type { AuthPort } from './types.js';
import {
  BORJIE_STATIC_RESOURCES,
  BORJIE_RESOURCE_TEMPLATES,
  resolveStaticResource,
  resolveTemplateResource,
  type ResourceResolvers,
} from './mcp-resources.js';
import {
  BORJIE_PROMPTS,
  getPrompt as getPromptOutcome,
  type McpPromptArgument,
  type McpPromptMessage,
} from './prompts.js';

// ============================================================================
// Handler registry shape
// ============================================================================

export type HandlerMap = Readonly<Record<string, McpToolHandler>>;

// ============================================================================
// Factory deps
// ============================================================================

export interface BossnyumbaMcpDeps {
  readonly auth: AuthPort;
  readonly handlers: HandlerMap;
  readonly resourceResolvers: ResourceResolvers;
  readonly costLedger?: CostLedgerPort;
  readonly tierRouter?: TierRouter;
  readonly config?: Partial<McpServerConfig>;
}

// ============================================================================
// The value returned by `createBossnyumbaMcpServer`
// ============================================================================

export interface BossnyumbaMcpServer {
  readonly config: McpServerConfig;
  readonly tools: ReadonlyArray<McpToolDefinition>;
  readonly staticResources: typeof BORJIE_STATIC_RESOURCES;
  readonly templateResources: typeof BORJIE_RESOURCE_TEMPLATES;
  readonly auth: AuthPort;
  invokeTool(
    toolName: string,
    input: Record<string, unknown>,
    context: McpAuthContext,
  ): Promise<WrappedToolInvocation>;
  readStaticResource(
    uri: string,
    context: McpAuthContext,
  ): Promise<string>;
  readTemplateResource(
    uri: string,
    variables: Record<string, string>,
    context: McpAuthContext,
  ): Promise<string>;
  costSnapshot(tenantId: string): Promise<McpCostSnapshot>;
  flushCosts(): Promise<number>;
  shutdown(): void;
}

// ============================================================================
// Factory
// ============================================================================

const DEFAULT_CONFIG: McpServerConfig = Object.freeze({
  name: 'borjie-mcp-server',
  version: '0.1.0',
  description:
    'BORJIE property-management platform — MCP server exposing tenant-scoped tools and resources to Claude Desktop, GPT, Cursor, and partner platforms.',
});

export function createBossnyumbaMcpServer(
  deps: BossnyumbaMcpDeps,
): BossnyumbaMcpServer {
  const config: McpServerConfig = Object.freeze({
    ...DEFAULT_CONFIG,
    ...(deps.config ?? {}),
  });
  const tierRouter = deps.tierRouter ?? createTierRouter();
  const ledger: CostLedgerPort = deps.costLedger ?? createInMemoryCostLedger();
  const batcher: CostBatcher = createCostBatcher(ledger);

  // Per-tenant monthly spend cache (very short TTL — we still re-fetch
  // when the batcher just flushed, but avoid hammering it per-tool).
  const spendCache = new Map<
    string,
    { readonly value: number; readonly expires: number }
  >();
  const SPEND_CACHE_TTL_MS = 15_000;
  async function getMonthlySpend(tenantId: string): Promise<number> {
    const cached = spendCache.get(tenantId);
    if (cached && cached.expires > Date.now()) return cached.value;
    const snapshot = await ledger.snapshot(tenantId);
    spendCache.set(tenantId, {
      value: snapshot.totalCostUsdMicro,
      expires: Date.now() + SPEND_CACHE_TTL_MS,
    });
    return snapshot.totalCostUsdMicro;
  }

  const recordCost = (entry: McpCostEntry): void => {
    batcher.enqueue(entry);
    // bust the spend cache so the next call sees up-to-date total
    spendCache.delete(entry.tenantId);
  };

  // Build wrapped handlers for every tool that has a concrete backing handler.
  const wrapped = new Map<
    string,
    (
      input: Record<string, unknown>,
      context: McpAuthContext,
    ) => Promise<WrappedToolInvocation>
  >();

  for (const toolDef of BORJIE_TOOLS) {
    if (toolDef.name === 'run_skill') continue; // wired after — needs wrapped map
    const handler = deps.handlers[toolDef.name];
    if (!handler) continue;
    wrapped.set(
      toolDef.name,
      wrapToolHandler(toolDef, handler, {
        tierRouter,
        recordCost,
        getMonthlySpend,
      }),
    );
  }

  // `run_skill` dispatches via the wrapped map.
  const runSkillDef = findToolDefinition('run_skill');
  if (runSkillDef) {
    const runSkillHandler = createRunSkillHandler(wrapped);
    wrapped.set(
      'run_skill',
      wrapToolHandler(runSkillDef, runSkillHandler, {
        tierRouter,
        recordCost,
        getMonthlySpend,
      }),
    );
  }

  return {
    config,
    tools: BORJIE_TOOLS,
    staticResources: BORJIE_STATIC_RESOURCES,
    templateResources: BORJIE_RESOURCE_TEMPLATES,
    auth: deps.auth,

    async invokeTool(toolName, input, context) {
      const wrappedHandler = wrapped.get(toolName);
      if (!wrappedHandler) {
        return {
          toolName,
          result: {
            ok: false,
            error: `Unknown tool: ${toolName}`,
            errorCode: 'TOOL_NOT_FOUND',
          },
          durationMs: 0,
          cost: Object.freeze({
            tenantId: context.tenantId,
            principalId: context.principalId,
            toolName,
            tier: context.tier,
            estimatedCostUsdMicro: 0,
            durationMs: 0,
            wasFree: true,
            correlationId: context.correlationId,
            timestamp: new Date().toISOString(),
          }),
        };
      }
      return wrappedHandler(input, context);
    },

    async readStaticResource(uri, context) {
      return resolveStaticResource(uri, context, deps.resourceResolvers);
    },

    async readTemplateResource(uri, variables, context) {
      return resolveTemplateResource(
        uri,
        variables,
        context,
        deps.resourceResolvers,
      );
    },

    async costSnapshot(tenantId) {
      return ledger.snapshot(tenantId);
    },

    async flushCosts() {
      return batcher.flush();
    },

    shutdown() {
      batcher.stop();
    },
  };
}

// ============================================================================
// SDK attachment helper (optional — for HTTP SSE mounting in api-gateway)
// ============================================================================

/**
 * Minimal shape of the `McpServer` we need from `@modelcontextprotocol/sdk`.
 * Typed as an interface so this package typechecks even without the SDK's
 * type declarations loaded.
 */
export interface McpSdkServerLike {
  tool(
    name: string,
    description: string,
    inputSchema: Record<string, unknown>,
    handler: (args: Record<string, unknown>) => Promise<McpSdkToolResponse>,
  ): void;
  resource(
    name: string,
    uri: string,
    options: Record<string, unknown>,
    handler: () => Promise<McpSdkResourceResponse>,
  ): void;
  /**
   * Optional — only present on SDK versions that ship the `prompts`
   * capability. The attachment helper feature-detects this method
   * before registering so older SDK builds still work.
   */
  prompt?(
    name: string,
    description: string,
    args: ReadonlyArray<McpPromptArgument>,
    handler: (args: Record<string, unknown>) => Promise<McpSdkPromptResponse>,
  ): void;
}

export interface McpSdkPromptResponse {
  readonly description: string;
  readonly messages: ReadonlyArray<McpPromptMessage>;
  readonly isError?: boolean;
}

export interface McpSdkToolResponse {
  readonly content: ReadonlyArray<{ readonly type: 'text'; readonly text: string }>;
  readonly isError?: boolean;
}

export interface McpSdkResourceResponse {
  readonly contents: ReadonlyArray<{
    readonly uri: string;
    readonly mimeType: string;
    readonly text: string;
  }>;
}

/**
 * Register every tool and static resource on an SDK `McpServer`. Call this
 * once from the api-gateway composition root after constructing both the
 * SDK server and the Bossnyumba façade.
 *
 * NOTE: the SDK server is per-connection; the auth context is resolved
 * from the connection's metadata via `resolveContext`. Callers are
 * responsible for wiring that (e.g. from SSE headers).
 */
export function attachToMcpSdkServer(
  sdkServer: McpSdkServerLike,
  borjie: BossnyumbaMcpServer,
  resolveContext: () => McpAuthContext,
): void {
  for (const toolDef of borjie.tools) {
    sdkServer.tool(
      toolDef.name,
      toolDef.description,
      toSdkInputSchema(toolDef),
      async (args) => {
        const context = resolveContext();
        const invocation = await borjie.invokeTool(
          toolDef.name,
          args,
          context,
        );
        if (!invocation.result.ok) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    error: invocation.result.error,
                    errorCode: invocation.result.errorCode,
                  },
                  null,
                  2,
                ),
              },
            ],
            isError: true,
          };
        }
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(invocation.result.data, null, 2),
            },
          ],
        };
      },
    );
  }

  for (const resource of borjie.staticResources) {
    sdkServer.resource(
      resource.name,
      resource.uri,
      { description: resource.description, mimeType: resource.mimeType },
      async () => {
        const context = resolveContext();
        const text = await borjie.readStaticResource(resource.uri, context);
        return {
          contents: [
            {
              uri: resource.uri,
              mimeType: resource.mimeType,
              text,
            },
          ],
        };
      },
    );
  }

  // Register prompts when the SDK exposes the `prompts` registration
  // method. Older SDK builds (pre-2024-11-05) lacked this surface, so
  // we feature-detect rather than require it. JSON-RPC clients reach
  // prompts via the gateway's `prompts/list` + `prompts/get` arms
  // regardless of SDK support.
  if (typeof sdkServer.prompt === 'function') {
    for (const promptDef of BORJIE_PROMPTS) {
      sdkServer.prompt(
        promptDef.name,
        promptDef.description,
        promptDef.arguments,
        async (rawArgs) => {
          const context = resolveContext();
          // Coerce arg values to strings — the renderer expects text
          // and treats missing / empty values as absent.
          const args: Record<string, string> = {};
          for (const [k, v] of Object.entries(rawArgs ?? {})) {
            args[k] = typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v);
          }
          const outcome = getPromptOutcome(promptDef.name, args, context);
          if (outcome.ok === true) {
            return {
              description: outcome.result.description,
              messages: outcome.result.messages,
            };
          }
          return {
            description: outcome.error,
            messages: [
              {
                role: 'system',
                content: { type: 'text', text: `${outcome.errorCode}: ${outcome.error}` },
              },
            ],
            isError: true,
          };
        },
      );
    }
  }
}

function toSdkInputSchema(
  tool: McpToolDefinition,
): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(tool.inputSchema)) {
    const prop: Record<string, unknown> = { type: v.type };
    if (v.description) prop.description = v.description;
    if (v.enum) prop.enum = [...v.enum];
    properties[k] = prop;
  }
  return {
    type: 'object',
    properties,
    required: [...tool.requiredInputs],
  };
}
