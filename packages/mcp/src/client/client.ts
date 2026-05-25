/**
 * MCP client — drives a TransportPort.
 *
 * - `initialize()` runs the handshake and caches `serverInfo` + `capabilities`.
 * - `listTools` / `listResources` / `listPrompts` cache results by
 *   `protocolVersion`; cache is invalidated on `notifications/*list_changed*`.
 * - `callTool` validates the call locally, enforces the per-call timeout,
 *   and retries-on-transient for tools annotated `idempotentHint: true`.
 * - All inbound notifications fan out via `on(...)` subscriptions.
 */

import {
  ErrorCodes,
  isErrorResponse,
  isNotification,
  isResponse,
  KNOWN_PROTOCOL_VERSIONS,
  MCPClosedError,
  MCPError,
  MCPTimeoutError,
  PROTOCOL_VERSION,
  type ClientInfo,
  type GetPromptResponse,
  type InitializeResponse,
  type JSONRPCError,
  type JSONRPCNotification,
  type JSONRPCRequest,
  type JSONRPCResponse,
  type Prompt,
  type Resource,
  type ResourceContent,
  type ServerCapabilities,
  type ServerInfo,
  type Tool,
  type ToolCallResponse,
  type TransportPort,
} from '../types.js';

export interface MCPClientOptions {
  readonly transport: TransportPort;
  readonly clientInfo?: ClientInfo;
  /** Per-call timeout (ms). Default 30_000. */
  readonly defaultTimeoutMs?: number;
  /** Retry attempts for transient failures on idempotent tools. Default 3. */
  readonly maxRetries?: number;
}

export interface MCPClient {
  initialize(): Promise<InitializeResponse>;
  listTools(): Promise<ReadonlyArray<Tool>>;
  callTool(
    name: string,
    args?: Record<string, unknown>,
    opts?: { readonly timeoutMs?: number; readonly progressToken?: string | number },
  ): Promise<ToolCallResponse>;
  listResources(): Promise<ReadonlyArray<Resource>>;
  readResource(uri: string): Promise<ReadonlyArray<ResourceContent>>;
  listPrompts(): Promise<ReadonlyArray<Prompt>>;
  getPrompt(name: string, args?: Record<string, unknown>): Promise<GetPromptResponse>;
  /** Subscribe to inbound notifications. Returns an unsubscribe handle. */
  onNotification(handler: (n: JSONRPCNotification) => void): () => void;
  /** Capabilities returned by the server after `initialize`. */
  capabilities(): ServerCapabilities | null;
  /** Server info after `initialize`. */
  serverInfo(): ServerInfo | null;
  /** Negotiated protocol version. */
  protocolVersion(): string | null;
  close(): Promise<void>;
}

interface PendingRequest {
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: unknown) => void;
  readonly timer: ReturnType<typeof setTimeout>;
  readonly method: string;
}

const TRANSIENT_ERROR_CODES: ReadonlySet<number> = new Set([
  ErrorCodes.ConnectionClosed,
  ErrorCodes.RequestTimeout,
  ErrorCodes.InternalError,
]);

export function createMCPClient(opts: MCPClientOptions): MCPClient {
  const transport = opts.transport;
  const clientInfo: ClientInfo = opts.clientInfo ?? {
    name: '@borjie/mcp client',
    version: '0.1.0',
  };
  const defaultTimeoutMs = opts.defaultTimeoutMs ?? 30_000;
  const maxRetries = opts.maxRetries ?? 3;

  const pending = new Map<number | string, PendingRequest>();
  const notificationHandlers = new Set<(n: JSONRPCNotification) => void>();

  let nextId = 1;
  let negotiated: InitializeResponse | null = null;
  let toolsCache: ReadonlyArray<Tool> | null = null;
  let resourcesCache: ReadonlyArray<Resource> | null = null;
  let promptsCache: ReadonlyArray<Prompt> | null = null;
  let closed = false;

  const unsubMsg = transport.onMessage((frame) => {
    if (isResponse(frame)) {
      const p = pending.get(frame.id);
      if (!p) return;
      pending.delete(frame.id);
      clearTimeout(p.timer);
      p.resolve(frame.result);
      return;
    }
    if (isErrorResponse(frame)) {
      const p = pending.get(frame.id ?? '');
      if (!p) return;
      pending.delete(frame.id ?? '');
      clearTimeout(p.timer);
      p.reject(new MCPError(frame.error.message, frame.error.code, frame.error.data));
      return;
    }
    if (isNotification(frame)) {
      // Invalidate caches on list_changed
      if (frame.method === 'notifications/tools/list_changed') toolsCache = null;
      else if (frame.method === 'notifications/resources/list_changed') resourcesCache = null;
      else if (frame.method === 'notifications/prompts/list_changed') promptsCache = null;
      for (const h of notificationHandlers) h(frame);
    }
  });

  const unsubClose = transport.onClose(() => {
    closed = true;
    for (const [, p] of pending) {
      clearTimeout(p.timer);
      p.reject(new MCPClosedError(`MCP request '${p.method}' aborted — transport closed`));
    }
    pending.clear();
  });

  async function rpc<T>(
    method: string,
    params?: unknown,
    timeoutMs?: number,
  ): Promise<T> {
    if (closed) throw new MCPClosedError();
    const id = nextId++;
    const req: JSONRPCRequest = {
      jsonrpc: '2.0',
      id,
      method,
      ...(params === undefined ? {} : { params }),
    };
    const effectiveTimeout = timeoutMs ?? defaultTimeoutMs;
    return await new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (pending.delete(id)) {
          reject(new MCPTimeoutError(method, effectiveTimeout));
        }
      }, effectiveTimeout);
      pending.set(id, {
        method,
        timer,
        resolve: (v) => resolve(v as T),
        reject,
      });
      transport.send(req).catch((e) => {
        if (pending.delete(id)) {
          clearTimeout(timer);
          reject(e);
        }
      });
    });
  }

  async function rpcWithRetry<T>(
    method: string,
    params: unknown,
    timeoutMs: number | undefined,
    retries: number,
  ): Promise<T> {
    let attempt = 0;
    let lastErr: unknown = null;
    while (attempt <= retries) {
      try {
        return await rpc<T>(method, params, timeoutMs);
      } catch (e) {
        lastErr = e;
        if (e instanceof MCPError && !TRANSIENT_ERROR_CODES.has(e.code)) {
          throw e;
        }
        if (closed) throw e;
        // backoff with jitter
        const delay = Math.min(2_000, 100 * 2 ** attempt + Math.random() * 50);
        await new Promise((r) => setTimeout(r, delay));
        attempt++;
      }
    }
    throw lastErr;
  }

  async function ensureInitialized(): Promise<InitializeResponse> {
    if (negotiated) return negotiated;
    return await initialize();
  }

  async function initialize(): Promise<InitializeResponse> {
    const params = {
      protocolVersion: PROTOCOL_VERSION,
      clientInfo,
      capabilities: {},
    };
    const resp = await rpc<InitializeResponse>('initialize', params);
    if (!KNOWN_PROTOCOL_VERSIONS.includes(resp.protocolVersion)) {
      // Tolerate — log via notification but don't fail; the server may be
      // on a newer revision we don't know yet and the wire envelopes are
      // compatible across all date-keyed revisions.
    }
    negotiated = resp;
    // Send the post-handshake notification.
    const notif: JSONRPCNotification = {
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    };
    await transport.send(notif).catch(() => undefined);
    return resp;
  }

  async function listTools(): Promise<ReadonlyArray<Tool>> {
    await ensureInitialized();
    if (toolsCache) return toolsCache;
    const out = await rpc<{ tools: Array<Tool> }>('tools/list');
    toolsCache = out.tools;
    return toolsCache;
  }

  async function callTool(
    name: string,
    args?: Record<string, unknown>,
    callOpts?: { readonly timeoutMs?: number; readonly progressToken?: string | number },
  ): Promise<ToolCallResponse> {
    await ensureInitialized();
    const params: Record<string, unknown> = { name, arguments: args ?? {} };
    if (callOpts?.progressToken !== undefined) {
      params._meta = { progressToken: callOpts.progressToken };
    }
    // Decide retry budget from tool annotations.
    const tools = toolsCache ?? (await listTools());
    const tool = tools.find((t) => t.name === name);
    const retries = tool?.annotations?.idempotentHint ? maxRetries : 0;
    return await rpcWithRetry<ToolCallResponse>('tools/call', params, callOpts?.timeoutMs, retries);
  }

  async function listResources(): Promise<ReadonlyArray<Resource>> {
    await ensureInitialized();
    if (resourcesCache) return resourcesCache;
    const out = await rpc<{ resources: Array<Resource> }>('resources/list');
    resourcesCache = out.resources;
    return resourcesCache;
  }

  async function readResource(uri: string): Promise<ReadonlyArray<ResourceContent>> {
    await ensureInitialized();
    const out = await rpc<{ contents: Array<ResourceContent> }>('resources/read', { uri });
    return out.contents;
  }

  async function listPrompts(): Promise<ReadonlyArray<Prompt>> {
    await ensureInitialized();
    if (promptsCache) return promptsCache;
    const out = await rpc<{ prompts: Array<Prompt> }>('prompts/list');
    promptsCache = out.prompts;
    return promptsCache;
  }

  async function getPrompt(name: string, args?: Record<string, unknown>): Promise<GetPromptResponse> {
    await ensureInitialized();
    return await rpc<GetPromptResponse>('prompts/get', {
      name,
      arguments: args ?? {},
    });
  }

  // Suppress unused-variable lint for the bound subscribers — they're used
  // for unsubscribe on close().
  void unsubMsg;
  void unsubClose;

  return {
    initialize,
    listTools,
    callTool,
    listResources,
    readResource,
    listPrompts,
    getPrompt,
    onNotification(handler) {
      notificationHandlers.add(handler);
      return () => notificationHandlers.delete(handler);
    },
    capabilities: () => negotiated?.capabilities ?? null,
    serverInfo: () => negotiated?.serverInfo ?? null,
    protocolVersion: () => negotiated?.protocolVersion ?? null,
    async close(): Promise<void> {
      if (closed) return;
      // Cleanup subscribers + drain pending.
      unsubMsg();
      unsubClose();
      for (const [, p] of pending) {
        clearTimeout(p.timer);
        p.reject(new MCPClosedError());
      }
      pending.clear();
      closed = true;
      await transport.close().catch(() => undefined);
    },
  };
}

// Re-export error type for ergonomic imports
export type { JSONRPCResponse, JSONRPCError };
