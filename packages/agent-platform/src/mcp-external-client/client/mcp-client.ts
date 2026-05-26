/**
 * The MCP external client — top-level facade.
 *
 * Owns a map of live `McpServerHandle`s keyed by `(tenantId, serverId)`.
 * Connects on demand, lists tools, dispatches calls, closes on shutdown.
 *
 * The SDK `Client` instance lives behind an `McpClientLike` interface
 * (`types.ts`) so tests can inject a fake without touching the SDK.
 * The default factory imports the SDK lazily; mirrors the lazy-import
 * pattern from `services/mcp-server-tra/src/mcp.ts`.
 *
 * Spec: `Docs/DESIGN/MCP_EXTERNAL_CLIENT_SPEC.md` §2.
 */

import type {
  McpCatalogEntry,
  McpClientFactory,
  McpClientLike,
  McpServerHandle,
  McpToolDescriptor,
  McpToolInvocation,
  McpToolResult,
} from '../types.js';

interface HandleSlot {
  readonly handle: McpServerHandle;
  readonly client: McpClientLike;
}

export interface McpExternalClientDeps {
  readonly factory: McpClientFactory;
  readonly resolveAuth: (
    tenantId: string,
    entry: McpCatalogEntry,
  ) => Promise<{
    readonly tenantId: string;
    readonly serverId: string;
    readonly mode: McpCatalogEntry['auth'];
    readonly accessToken?: string;
    readonly apiKey?: string;
    readonly expiresAt?: number;
  }>;
  readonly now?: () => number;
}

function handleKey(tenantId: string, serverId: string): string {
  return `${tenantId}::${serverId}`;
}

/**
 * `createMcpExternalClient(deps)` — returns the facade. The facade is
 * immutable; only its internal Map is mutated, kept private behind the
 * closure.
 */
export function createMcpExternalClient(deps: McpExternalClientDeps): {
  readonly connect: (
    tenantId: string,
    entry: McpCatalogEntry,
  ) => Promise<McpServerHandle>;
  readonly listTools: (
    tenantId: string,
    serverId: string,
  ) => Promise<ReadonlyArray<McpToolDescriptor>>;
  readonly invokeTool: (
    invocation: McpToolInvocation,
  ) => Promise<McpToolResult>;
  readonly closeAll: () => Promise<void>;
  readonly handleCount: () => number;
} {
  const handles = new Map<string, HandleSlot>();
  const now = deps.now ?? Date.now;

  async function connect(
    tenantId: string,
    entry: McpCatalogEntry,
  ): Promise<McpServerHandle> {
    const key = handleKey(tenantId, entry.id);
    const existing = handles.get(key);
    if (existing) return existing.handle;

    const auth = await deps.resolveAuth(tenantId, entry);
    const client = await deps.factory(entry, auth);
    const tools = await client.listTools();

    const handle: McpServerHandle = Object.freeze({
      tenantId,
      serverId: entry.id,
      entry,
      tools,
      connectedAt: now(),
      close: async () => {
        const slot = handles.get(key);
        if (slot) {
          handles.delete(key);
          await slot.client.close();
        }
      },
    });

    handles.set(key, { handle, client });
    return handle;
  }

  async function listTools(
    tenantId: string,
    serverId: string,
  ): Promise<ReadonlyArray<McpToolDescriptor>> {
    const slot = handles.get(handleKey(tenantId, serverId));
    if (!slot) {
      throw new Error(
        `mcp-external-client: no live handle for tenant=${tenantId} server=${serverId} — call connect() first`,
      );
    }
    return slot.handle.tools;
  }

  async function invokeTool(
    invocation: McpToolInvocation,
  ): Promise<McpToolResult> {
    const slot = handles.get(
      handleKey(invocation.tenantId, invocation.serverId),
    );
    if (!slot) {
      throw new Error(
        `mcp-external-client: no live handle for tenant=${invocation.tenantId} server=${invocation.serverId}`,
      );
    }
    return slot.client.callTool(invocation.toolName, invocation.input);
  }

  async function closeAll(): Promise<void> {
    const slots = Array.from(handles.values());
    handles.clear();
    await Promise.all(
      slots.map(async (slot) => {
        try {
          await slot.client.close();
        } catch {
          // swallow — closeAll is best-effort.
        }
      }),
    );
  }

  function handleCount(): number {
    return handles.size;
  }

  return Object.freeze({
    connect,
    listTools,
    invokeTool,
    closeAll,
    handleCount,
  });
}
