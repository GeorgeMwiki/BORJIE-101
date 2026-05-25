/**
 * @borjie/mcp-server-process-intel — MCP server entrypoint.
 *
 * Listens on stdio for local dev (Anthropic's default MCP transport)
 * and can optionally listen on HTTP/SSE in production when env
 * `MCP_PROCESS_INTEL_HTTP_PORT` is set.
 *
 * Tool grammar: 9 tools mirroring Microsoft Power Automate Process
 * Mining's MCP server (Apr 2026 release). pm4py runs in a separate
 * Python sidecar (AGPL-3.0); the process boundary keeps AGPL'd code
 * isolated from this MIT codebase (AGPL section 13).
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { PROCESS_INTEL_TOOLS, findProcessIntelTool } from './tools/index.js';
import { Pm4pyClient, type Pm4pyClientConfig } from './pm4py-client.js';
import type { ProcessIntelTool, ToolDeps } from './types.js';
import { logger } from './logger.js';

// CRITICAL-4 + CRITICAL-5 (audit .audit/post-pr90-api-mcp-bug-sweep.md):
//   - C4: every tool must Zod-validate its input BEFORE execution. We
//     enforce a minimal `{tenantId: string}` shape at the dispatcher
//     level so even tools that don't carry their own schema cannot run
//     with an unset/non-string tenantId.
//   - C5: process-intel had NO tenant allowlist guard. Without it, any
//     stdio caller can query any tenant's event log. We mirror the
//     allowlist pattern of the other four MCP servers.
const BaseInputSchema = z.object({
  tenantId: z.string().min(1).max(128),
}).passthrough();

const ALLOWLIST_ENV_VAR = 'MCP_TENANT_ALLOWLIST';
function readEnvAllowlist(key: string): ReadonlyArray<string> | null {
  const raw = process.env[ALLOWLIST_ENV_VAR];
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, ReadonlyArray<string>>;
    const list = parsed?.[key];
    return Array.isArray(list) ? list : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Server config
// ---------------------------------------------------------------------------

export interface ProcessIntelServerConfig {
  readonly name?: string;
  readonly version?: string;
  readonly pm4py?: Pm4pyClientConfig;
  /** Inject a pre-built client (tests use this to swap in a mock). */
  readonly pm4pyClient?: Pm4pyClient;
  /**
   * CRITICAL-5: per-tenant allowlist. When set, only listed tenants
   * may invoke any tool. When unset, falls back to env
   * `MCP_TENANT_ALLOWLIST['process_intel']`. When BOTH are unset:
   *   - non-production (`NODE_ENV !== 'production'`) → bypass (so dev
   *     and test flows keep working)
   *   - production → deny all (fail closed)
   */
  readonly allowlist?: ReadonlyArray<string>;
}

const DEFAULT_NAME = 'borjie-mcp-process-intel';
const DEFAULT_VERSION = '0.1.0';

// ---------------------------------------------------------------------------
// Factory — exported for tests + the api-gateway adapter
// ---------------------------------------------------------------------------

export function createProcessIntelServer(
  config: ProcessIntelServerConfig = {},
): {
  readonly server: Server;
  readonly pm4py: Pm4pyClient;
  readonly tools: ReadonlyArray<ProcessIntelTool>;
} {
  const pm4py = config.pm4pyClient ?? new Pm4pyClient(config.pm4py);
  const deps: ToolDeps = Object.freeze({ pm4py });

  const server = new Server(
    {
      name: config.name ?? DEFAULT_NAME,
      version: config.version ?? DEFAULT_VERSION,
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  // tools/list — advertise the 9-tool grammar
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: PROCESS_INTEL_TOOLS.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema as unknown as Record<string, unknown>,
    })),
  }));

  const allowlist: ReadonlyArray<string> | null =
    config.allowlist ?? readEnvAllowlist('process_intel') ?? null;

  // tools/call — dispatch to the matching tool, route through pm4py sidecar
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args, _meta } = request.params;
    const tool = findProcessIntelTool(name);
    if (!tool) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `Unknown tool: ${name}. Known tools: ${PROCESS_INTEL_TOOLS.map((t) => t.name).join(', ')}`,
          },
        ],
      };
    }

    // CRITICAL-4: enforce a minimal Zod shape on every call. Tool
    // implementations may add stricter per-tool validation, but the
    // dispatcher refuses anything without a non-empty string tenantId.
    const parsed = BaseInputSchema.safeParse(args ?? {});
    if (!parsed.success) {
      const path = parsed.error.issues[0]?.path?.join('.') ?? 'input';
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `process_intel: input validation failed at '${path}'`,
          },
        ],
      };
    }

    // CRITICAL-5: enforce per-tenant allowlist (mirrors the four other
    // MCP servers). Resolves tenantId from args first (Zod-validated
    // above), then from `_meta.tenantId` for transports that inject
    // verified context out-of-band.
    const metaTenantId =
      (_meta as { tenantId?: unknown } | undefined)?.tenantId;
    const tenantId =
      typeof parsed.data.tenantId === 'string' && parsed.data.tenantId
        ? parsed.data.tenantId
        : typeof metaTenantId === 'string'
          ? metaTenantId
          : '';
    if (!tenantId) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: 'process_intel: missing tenantId — required in args.tenantId or request._meta.tenantId',
          },
        ],
      };
    }
    const allowlistResolved =
      allowlist ??
      (process.env.NODE_ENV === 'production' ? ([] as ReadonlyArray<string>) : null);
    if (allowlistResolved && !allowlistResolved.includes(tenantId)) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `process_intel: tenant '${tenantId}' is not in the per-tenant allowlist`,
          },
        ],
      };
    }

    try {
      const result = await tool.execute((args ?? {}) as never, deps);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result),
          },
        ],
      };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'unknown sidecar error';
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `process_intel error in ${name}: ${message}`,
          },
        ],
      };
    }
  });

  return Object.freeze({
    server,
    pm4py,
    tools: PROCESS_INTEL_TOOLS,
  });
}

// ---------------------------------------------------------------------------
// CLI bootstrap (only runs when invoked as a script)
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const { server, pm4py } = createProcessIntelServer();

  const transport = new StdioServerTransport();
  await server.connect(transport);

  const shutdown = async (): Promise<void> => {
    try {
      await pm4py.close();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

// `import.meta.url === pathToFileURL(process.argv[1]).href` is the
// ESM-safe equivalent of `require.main === module`. Wrapped in a
// try/catch so importing this file from a test doesn't accidentally
// kick off the server.
const invokedDirectly = (() => {
  try {
    if (!process.argv[1]) return false;
    const argvUrl = new URL(`file://${process.argv[1]}`).href;
    return import.meta.url === argvUrl;
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  main().catch((err) => {
    logger.error('[process-intel] fatal', { error: err });
    process.exit(1);
  });
}

// Re-exports for downstream consumers (api-gateway adapter, tests)
export { PROCESS_INTEL_TOOLS, findProcessIntelTool } from './tools/index.js';
export { Pm4pyClient } from './pm4py-client.js';
export { normaliseEventLog } from './event-log-loader.js';
export type {
  ProcessIntelTool,
  ToolDeps,
  EventLogBatch,
  EventLogRecord,
  Pm4pyCommand,
  Pm4pyCommandKind,
  Pm4pyResponse,
} from './types.js';
export { Pm4pySidecarError } from './types.js';
