/**
 * MCP discovery — read `.mcp.json` configs, namespace tools across servers,
 * and dispatch a namespaced call to the right client.
 *
 * `.mcp.json` shape (compatible with Claude Desktop / Cursor convention):
 *
 *   {
 *     "mcpServers": {
 *       "<serverId>": {
 *         "command": "...",   // stdio
 *         "args": [...],
 *         "env": { ... },
 *         "url": "...",        // streamable-http or sse (mutually exclusive
 *                              // with command)
 *         "transport": "stdio" | "sse" | "streamable-http",
 *         "headers": { ... }
 *       }
 *     }
 *   }
 */

import { z } from 'zod';
import type { MCPClient } from '../client/client.js';
import type { ToolCallResponse } from '../types.js';

export const MCPServerConfigSchema = z
  .object({
    command: z.string().optional(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
    url: z.string().url().optional(),
    transport: z.enum(['stdio', 'sse', 'streamable-http']).optional(),
    headers: z.record(z.string(), z.string()).optional(),
    cwd: z.string().optional(),
  })
  .refine(
    (v) => Boolean(v.command) !== Boolean(v.url),
    'Exactly one of `command` (stdio) or `url` (http) must be set',
  );

export const MCPConfigSchema = z.object({
  mcpServers: z.record(z.string(), MCPServerConfigSchema),
});

export type MCPServerConfigEntry = z.infer<typeof MCPServerConfigSchema>;
export type MCPConfig = z.infer<typeof MCPConfigSchema>;

export interface DiscoveredServer {
  readonly serverId: string;
  readonly config: MCPServerConfigEntry;
  readonly transportKind: 'stdio' | 'sse' | 'streamable-http';
}

/**
 * Parse a config object (already-read JSON). Returns the list of discovered
 * servers, with the transport kind inferred (`command` ⇒ stdio,
 * `url` defaults to `streamable-http` unless `transport` overrides).
 */
export function discoverFromConfig(raw: unknown): ReadonlyArray<DiscoveredServer> {
  const parsed = MCPConfigSchema.parse(raw);
  const out: Array<DiscoveredServer> = [];
  for (const [serverId, config] of Object.entries(parsed.mcpServers)) {
    const transportKind: DiscoveredServer['transportKind'] =
      config.transport ?? (config.command ? 'stdio' : 'streamable-http');
    out.push({ serverId, config, transportKind });
  }
  return out;
}

/**
 * Namespacing — given a server id and a tool name, return the wire-level
 * namespaced name to expose to the LLM. The separator is `.` which is
 * safe across all known MCP-consuming clients.
 */
export function namespace(serverId: string, toolName: string): string {
  if (!serverId.match(/^[a-zA-Z0-9_-]+$/)) {
    throw new Error(`Invalid server id for namespacing: '${serverId}'`);
  }
  return `${serverId}.${toolName}`;
}

/** Inverse of `namespace` — split into `{ serverId, toolName }`. */
export function unnamespace(namespaced: string): {
  readonly serverId: string;
  readonly toolName: string;
} | null {
  const idx = namespaced.indexOf('.');
  if (idx <= 0 || idx === namespaced.length - 1) return null;
  return {
    serverId: namespaced.slice(0, idx),
    toolName: namespaced.slice(idx + 1),
  };
}

/**
 * Router — given a map of `serverId → MCPClient`, dispatches a namespaced
 * tool call to the right client. Throws if the prefix doesn't match any
 * server.
 */
export interface ToolRouter {
  routeCall(
    namespacedName: string,
    args?: Record<string, unknown>,
  ): Promise<ToolCallResponse>;
  listAllTools(): Promise<
    ReadonlyArray<{ namespacedName: string; serverId: string; description: string }>
  >;
}

export function createToolRouter(
  clients: ReadonlyMap<string, MCPClient>,
): ToolRouter {
  return {
    async routeCall(namespacedName, args) {
      const split = unnamespace(namespacedName);
      if (!split) {
        throw new Error(
          `Unrecognised tool name '${namespacedName}' — expected '<serverId>.<toolName>'`,
        );
      }
      const client = clients.get(split.serverId);
      if (!client) {
        throw new Error(
          `No MCP client registered for server '${split.serverId}' — known: [${[...clients.keys()].join(', ')}]`,
        );
      }
      return await client.callTool(split.toolName, args);
    },
    async listAllTools() {
      const out: Array<{ namespacedName: string; serverId: string; description: string }> = [];
      // Sequential to keep error reporting clean (we typically have <10
      // servers; pipelining would shadow per-server failures).
      for (const [serverId, client] of clients) {
        const tools = await client.listTools();
        for (const t of tools) {
          out.push({
            namespacedName: namespace(serverId, t.name),
            serverId,
            description: t.description,
          });
        }
      }
      return out;
    },
  };
}
