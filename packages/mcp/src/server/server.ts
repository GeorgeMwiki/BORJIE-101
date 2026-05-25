/**
 * MCP server framework — host tools, resources, and prompts over any
 * `TransportPort`. Tenant-scoped, audit-hooked, capability-negotiated.
 *
 * Design:
 *   - Stateless per-request handlers fed by a `SessionContext` resolved at
 *     transport-attach time (the same server can serve many sessions if you
 *     attach multiple transports).
 *   - All inbound JSON-RPC frames dispatch through a fixed method table.
 *   - Every tool/resource/prompt call goes through the audit hook before
 *     and after the handler, with `success`/`failure`/`denied` outcomes.
 *   - Tenant scope is injected from the session — never trusted from
 *     `params.tenantId` (we strip it if a client tries to set it).
 */

import { ZodError } from 'zod';
import {
  ErrorCodes,
  isNotification,
  isRequest,
  KNOWN_PROTOCOL_VERSIONS,
  MCPError,
  PROTOCOL_VERSION,
  TenantScopeError,
  type AuditEvent,
  type AuditPort,
  type ContentBlock,
  type GetPromptResponse,
  type InitializeRequest,
  type InitializeResponse,
  type JSONRPCError,
  type JSONRPCRequest,
  type JSONRPCResponse,
  type PromptDefinition,
  type ResourceDefinition,
  type ServerCapabilities,
  type SessionContext,
  type ToolCallResponse,
  type ToolDefinition,
  type TransportPort,
} from '../types.js';
import { zodToJsonSchema } from './zod-to-json-schema.js';

export interface MCPServerConfig {
  readonly name: string;
  readonly version: string;
  readonly description?: string;
  readonly tools?: ReadonlyArray<ToolDefinition<unknown, unknown>>;
  readonly resources?: ReadonlyArray<ResourceDefinition>;
  readonly prompts?: ReadonlyArray<PromptDefinition<unknown>>;
  /** Enable server-initiated sampling. Default false (opt-in per spec). */
  readonly sampling?: boolean;
  /** Audit hook — called on every tool/resource/prompt call. */
  readonly audit?: AuditPort;
  /** Optional policy hook — return false to deny the call. */
  readonly policyHook?: (
    ctx: SessionContext,
    method: string,
    params: unknown,
  ) => boolean | Promise<boolean>;
}

export interface AttachedSession {
  readonly transport: TransportPort;
  readonly context: SessionContext;
  detach(): Promise<void>;
}

export interface MCPServer {
  readonly name: string;
  readonly version: string;
  attach(transport: TransportPort, context: SessionContext): AttachedSession;
  listTools(): ReadonlyArray<{ name: string; description: string }>;
  listResources(): ReadonlyArray<{ uri: string; name: string }>;
  listPrompts(): ReadonlyArray<{ name: string }>;
}

export function createMCPServer(config: MCPServerConfig): MCPServer {
  const tools = new Map<string, ToolDefinition<unknown, unknown>>();
  for (const t of config.tools ?? []) tools.set(t.name, t);
  const resources = new Map<string, ResourceDefinition>();
  for (const r of config.resources ?? []) resources.set(r.uri, r);
  const prompts = new Map<string, PromptDefinition<unknown>>();
  for (const p of config.prompts ?? []) prompts.set(p.name, p);

  function serverCapabilities(): ServerCapabilities {
    const caps: { -readonly [K in keyof ServerCapabilities]: ServerCapabilities[K] } = {};
    if (tools.size > 0) caps.tools = { listChanged: false };
    if (resources.size > 0) caps.resources = { listChanged: false, subscribe: false };
    if (prompts.size > 0) caps.prompts = { listChanged: false };
    caps.logging = {};
    return caps;
  }

  async function audit(
    ctx: SessionContext,
    action: string,
    target: string,
    outcome: 'success' | 'failure' | 'denied',
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    if (!config.audit) return;
    try {
      const event: { -readonly [K in keyof AuditEvent]: AuditEvent[K] } = {
        tenantId: ctx.tenantId,
        sessionId: ctx.sessionId,
        action,
        target,
        outcome,
        timestamp: Date.now(),
      };
      if (ctx.principalId !== undefined) event.principalId = ctx.principalId;
      if (ctx.correlationId !== undefined) event.correlationId = ctx.correlationId;
      if (metadata !== undefined) event.metadata = metadata;
      await config.audit.append(event);
    } catch {
      // Audit failure must never break the request — log to stderr only
      // if a process logger is attached. We intentionally swallow here.
    }
  }

  function negotiateProtocolVersion(requested: string): string {
    // If the client asked for a version we know, return it. Otherwise pick
    // the highest we know that is ≤ what they asked for.
    if (KNOWN_PROTOCOL_VERSIONS.includes(requested)) return requested;
    const compatible = KNOWN_PROTOCOL_VERSIONS.find((v) => v <= requested);
    return compatible ?? KNOWN_PROTOCOL_VERSIONS[KNOWN_PROTOCOL_VERSIONS.length - 1] ?? PROTOCOL_VERSION;
  }

  async function handleInitialize(
    params: unknown,
  ): Promise<InitializeResponse> {
    const req = (params ?? {}) as Partial<InitializeRequest>;
    const requested = req.protocolVersion ?? PROTOCOL_VERSION;
    return {
      protocolVersion: negotiateProtocolVersion(requested),
      serverInfo: config.description !== undefined
        ? { name: config.name, version: config.version, description: config.description }
        : { name: config.name, version: config.version },
      capabilities: serverCapabilities(),
    };
  }

  function listToolsResponse(): { tools: Array<{ name: string; description: string; inputSchema: Record<string, unknown>; annotations?: unknown }> } {
    return {
      tools: Array.from(tools.values()).map((t) => {
        const out: { name: string; description: string; inputSchema: Record<string, unknown>; annotations?: unknown } = {
          name: t.name,
          description: t.description,
          inputSchema: zodToJsonSchema(t.inputSchema) as Record<string, unknown>,
        };
        if (t.annotations) out.annotations = t.annotations;
        return out;
      }),
    };
  }

  function listResourcesResponse(): { resources: Array<{ uri: string; name: string; description?: string; mimeType?: string }> } {
    return {
      resources: Array.from(resources.values()).map((r) => {
        const out: { uri: string; name: string; description?: string; mimeType?: string } = {
          uri: r.uri,
          name: r.name,
        };
        if (r.description !== undefined) out.description = r.description;
        if (r.mimeType !== undefined) out.mimeType = r.mimeType;
        return out;
      }),
    };
  }

  function listPromptsResponse(): { prompts: Array<{ name: string; description?: string; arguments?: ReadonlyArray<{ name: string; description?: string; required?: boolean }> }> } {
    return {
      prompts: Array.from(prompts.values()).map((p) => {
        const out: { name: string; description?: string; arguments?: ReadonlyArray<{ name: string; description?: string; required?: boolean }> } = {
          name: p.name,
        };
        if (p.description !== undefined) out.description = p.description;
        if (p.arguments) out.arguments = p.arguments;
        return out;
      }),
    };
  }

  async function handleCallTool(
    ctx: SessionContext,
    params: unknown,
  ): Promise<ToolCallResponse> {
    const callParams = (params ?? {}) as { name?: string; arguments?: Record<string, unknown> };
    const name = callParams.name;
    if (!name) throw new MCPError('Missing tool name', ErrorCodes.InvalidParams);
    const tool = tools.get(name);
    if (!tool) throw new MCPError(`Tool not found: ${name}`, ErrorCodes.MethodNotFound);

    // Strip any client-supplied tenantId — session is the source of truth.
    const rawArgs = { ...(callParams.arguments ?? {}) };
    if ('tenantId' in rawArgs && rawArgs.tenantId !== ctx.tenantId) {
      const attempted = String(rawArgs.tenantId);
      await audit(ctx, 'mcp.tool.call', `tool:${name}`, 'denied', {
        reason: 'tenant-scope-violation',
        attempted,
      });
      throw new TenantScopeError(
        `Tool '${name}' received tenantId='${attempted}' but session is bound to '${ctx.tenantId}'`,
        attempted,
        ctx.tenantId,
      );
    }
    delete rawArgs.tenantId;

    // Policy gate
    if (config.policyHook) {
      const allowed = await config.policyHook(ctx, 'tools/call', callParams);
      if (!allowed) {
        await audit(ctx, 'mcp.tool.call', `tool:${name}`, 'denied', { reason: 'policy' });
        throw new MCPError(`Tool '${name}' denied by policy`, ErrorCodes.Unauthorized);
      }
    }

    // Validate
    let parsedArgs: unknown;
    try {
      parsedArgs = tool.inputSchema.parse(rawArgs);
    } catch (e) {
      const issues = e instanceof ZodError ? e.issues : undefined;
      await audit(ctx, 'mcp.tool.call', `tool:${name}`, 'failure', { reason: 'invalid-args', issues });
      throw new MCPError(
        `Invalid arguments for tool '${name}': ${e instanceof Error ? e.message : 'validation failed'}`,
        ErrorCodes.InvalidParams,
        issues,
      );
    }

    try {
      const raw = await tool.handler(parsedArgs, ctx);
      await audit(ctx, 'mcp.tool.call', `tool:${name}`, 'success');
      return normalizeToolResult(raw);
    } catch (e) {
      await audit(ctx, 'mcp.tool.call', `tool:${name}`, 'failure', {
        error: e instanceof Error ? e.message : String(e),
      });
      throw e;
    }
  }

  async function handleReadResource(
    ctx: SessionContext,
    params: unknown,
  ): Promise<{ contents: ReadonlyArray<unknown> }> {
    const p = (params ?? {}) as { uri?: string };
    if (!p.uri) throw new MCPError('Missing resource uri', ErrorCodes.InvalidParams);
    const resource = resources.get(p.uri);
    if (!resource) throw new MCPError(`Resource not found: ${p.uri}`, ErrorCodes.MethodNotFound);
    try {
      const content = await resource.contentProvider(ctx);
      const list = Array.isArray(content) ? content : [content];
      await audit(ctx, 'mcp.resource.read', `resource:${p.uri}`, 'success');
      return { contents: list };
    } catch (e) {
      await audit(ctx, 'mcp.resource.read', `resource:${p.uri}`, 'failure', {
        error: e instanceof Error ? e.message : String(e),
      });
      throw e;
    }
  }

  async function handleGetPrompt(
    ctx: SessionContext,
    params: unknown,
  ): Promise<GetPromptResponse> {
    const p = (params ?? {}) as { name?: string; arguments?: Record<string, unknown> };
    if (!p.name) throw new MCPError('Missing prompt name', ErrorCodes.InvalidParams);
    const prompt = prompts.get(p.name);
    if (!prompt) throw new MCPError(`Prompt not found: ${p.name}`, ErrorCodes.MethodNotFound);
    const args = prompt.argsSchema ? prompt.argsSchema.parse(p.arguments ?? {}) : (p.arguments ?? {} as unknown);
    try {
      const res = await prompt.render(args, ctx);
      await audit(ctx, 'mcp.prompt.get', `prompt:${p.name}`, 'success');
      return res;
    } catch (e) {
      await audit(ctx, 'mcp.prompt.get', `prompt:${p.name}`, 'failure', {
        error: e instanceof Error ? e.message : String(e),
      });
      throw e;
    }
  }

  return {
    name: config.name,
    version: config.version,
    listTools: () =>
      Array.from(tools.values()).map((t) => ({
        name: t.name,
        description: t.description,
      })),
    listResources: () =>
      Array.from(resources.values()).map((r) => ({ uri: r.uri, name: r.name })),
    listPrompts: () => Array.from(prompts.values()).map((p) => ({ name: p.name })),

    attach(transport: TransportPort, context: SessionContext): AttachedSession {
      const unsubMsg = transport.onMessage(async (frame) => {
        if (isNotification(frame)) {
          // Server doesn't act on `notifications/initialized` etc — just ack.
          return;
        }
        if (!isRequest(frame)) return; // ignore responses inbound to a server
        await handleRequest(transport, context, frame);
      });

      return {
        transport,
        context,
        async detach(): Promise<void> {
          unsubMsg();
        },
      };
    },
  };

  async function handleRequest(
    transport: TransportPort,
    ctx: SessionContext,
    request: JSONRPCRequest,
  ): Promise<void> {
    let result: unknown;
    let error: { code: number; message: string; data?: unknown } | null = null;
    try {
      switch (request.method) {
        case 'initialize':
          result = await handleInitialize(request.params);
          break;
        case 'tools/list':
          result = listToolsResponse();
          break;
        case 'tools/call':
          result = await handleCallTool(ctx, request.params);
          break;
        case 'resources/list':
          result = listResourcesResponse();
          break;
        case 'resources/read':
          result = await handleReadResource(ctx, request.params);
          break;
        case 'prompts/list':
          result = listPromptsResponse();
          break;
        case 'prompts/get':
          result = await handleGetPrompt(ctx, request.params);
          break;
        case 'ping':
          result = {};
          break;
        default:
          throw new MCPError(
            `Method not found: ${request.method}`,
            ErrorCodes.MethodNotFound,
          );
      }
    } catch (e) {
      if (e instanceof MCPError) {
        const errBody: { code: number; message: string; data?: unknown } = {
          code: e.code,
          message: e.message,
        };
        if (e.data !== undefined) errBody.data = e.data;
        error = errBody;
      } else {
        error = {
          code: ErrorCodes.InternalError,
          message: e instanceof Error ? e.message : String(e),
        };
      }
    }

    if (error) {
      const frame: JSONRPCError = {
        jsonrpc: '2.0',
        id: request.id,
        error,
      };
      await transport.send(frame);
    } else {
      const frame: JSONRPCResponse = {
        jsonrpc: '2.0',
        id: request.id,
        result,
      };
      await transport.send(frame);
    }
  }
}

function normalizeToolResult(
  raw: unknown,
): ToolCallResponse {
  if (typeof raw === 'string') {
    return { content: [{ type: 'text', text: raw }] };
  }
  if (raw && typeof raw === 'object' && 'content' in raw && Array.isArray((raw as { content: unknown }).content)) {
    return raw as ToolCallResponse;
  }
  // Anything else: JSON-stringify into a text block.
  const text = typeof raw === 'string' ? raw : JSON.stringify(raw ?? null);
  const block: ContentBlock = { type: 'text', text };
  return { content: [block] };
}
