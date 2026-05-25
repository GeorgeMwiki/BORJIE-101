/**
 * MCP client adapter — registers the `@borjie/mcp-server-process-intel`
 * MCP server as a client of the api-gateway at boot.
 *
 * Lifecycle
 * ---------
 *  1. At boot, `createProcessIntelMcpBinding(registry)` is called from
 *     the api-gateway composition root.
 *  2. If env `MCP_PROCESS_INTEL_URL` is set, we connect to the running
 *     MCP server (stdio sub-process, or HTTP/SSE in production).
 *  3. The 9 Process Intel tools are wrapped as `BrainToolSpec`s under
 *     the `process_intel.*` namespace and registered into the kernel's
 *     `BrainToolRegistry` so the MD can call them.
 *  4. When the env is unset, we register `NOT_IMPLEMENTED` stubs so
 *     downstream code can still discover the tool names.
 *
 * The binding owns the lifetime of the spawned MCP client process —
 * `close()` must be called from the gateway's `onShutdown` hook.
 *
 * Tenant isolation: every tool call carries a `tenantId` in its input.
 * The MCP server enforces tenant scoping inside its pm4py sidecar; we
 * do not let callers omit `tenantId`.
 *
 * NOTE — pm4py is AGPL-3.0 and runs in a separate process inside the
 * `mcp-server-process-intel` container. This adapter is MIT — it only
 * speaks the MCP wire protocol to that process, never imports pm4py
 * source.
 */

import {
  createBrainToolRegistry,
  type BrainToolRegistry,
  type BrainToolSpec,
} from '@borjie/central-intelligence';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Wire-protocol shape — we deliberately do NOT import the in-process
// MCP server's TypeScript types here; this adapter only speaks the
// publicly-documented MCP `tools/call` JSON shape.
// ---------------------------------------------------------------------------

interface McpToolCallResult {
  readonly content?: ReadonlyArray<{
    readonly type: 'text';
    readonly text: string;
  }>;
  readonly isError?: boolean;
}

interface McpClientTransport {
  callTool(name: string, args: Readonly<Record<string, unknown>>): Promise<McpToolCallResult>;
  close(): Promise<void>;
}

// ---------------------------------------------------------------------------
// 9-tool MS-PA grammar — names + minimal Zod schemas so the BrainTool
// audit log captures structured input/output. We keep schemas loose
// (`z.unknown()` for the output) because the authoritative schema
// lives in the MCP server itself — duplicating it here would mean two
// places to update.
// ---------------------------------------------------------------------------

const TENANT_ARGS = z.object({
  tenantId: z.string().min(1),
});

const PROCESS_ARGS = TENANT_ARGS.extend({
  processId: z.string().min(1),
});

const PROCESS_INTEL_TOOL_NAMES = Object.freeze([
  'process_intel.get_processes',
  'process_intel.get_bottleneck_analysis',
  'process_intel.get_variants_with_metrics',
  'process_intel.get_correlation',
  'process_intel.get_conformance',
  'process_intel.get_loop_analysis',
  'process_intel.get_handoff_matrix',
  'process_intel.get_cycle_time_distribution',
  'process_intel.get_drift_alerts',
] as const);

type ProcessIntelToolName = (typeof PROCESS_INTEL_TOOL_NAMES)[number];

const SCHEMA_BY_NAME: Readonly<Record<ProcessIntelToolName, z.ZodTypeAny>> =
  Object.freeze({
    'process_intel.get_processes': TENANT_ARGS.passthrough(),
    'process_intel.get_bottleneck_analysis': PROCESS_ARGS.passthrough(),
    'process_intel.get_variants_with_metrics': PROCESS_ARGS.passthrough(),
    'process_intel.get_correlation': PROCESS_ARGS.passthrough(),
    'process_intel.get_conformance': PROCESS_ARGS.passthrough(),
    'process_intel.get_loop_analysis': PROCESS_ARGS.passthrough(),
    'process_intel.get_handoff_matrix': PROCESS_ARGS.passthrough(),
    'process_intel.get_cycle_time_distribution': PROCESS_ARGS.passthrough(),
    'process_intel.get_drift_alerts': PROCESS_ARGS.passthrough(),
  });

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface ProcessIntelBindingConfig {
  /**
   * URL of the running mcp-server-process-intel (HTTP/SSE transport).
   * When undefined, the binding registers `NOT_IMPLEMENTED` stubs so
   * tool discovery still works for callers, but execution returns a
   * structured error.
   */
  readonly url?: string;
  /**
   * Pre-built transport — tests inject a mock; production code lets
   * this default through to the URL-driven connector.
   */
  readonly transport?: McpClientTransport;
  /**
   * Existing BrainToolRegistry to merge into. When omitted, the binding
   * creates a fresh registry — useful for tests that just want to
   * inspect the registered tools.
   */
  readonly registry?: BrainToolRegistry;
}

export interface ProcessIntelBinding {
  readonly registry: BrainToolRegistry;
  readonly toolNames: ReadonlyArray<ProcessIntelToolName>;
  readonly transport: McpClientTransport | null;
  close(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Public factory
// ---------------------------------------------------------------------------

export function createProcessIntelMcpBinding(
  config: ProcessIntelBindingConfig = {},
): ProcessIntelBinding {
  const registry = config.registry ?? createBrainToolRegistry();
  const transport = resolveTransport(config);

  for (const name of PROCESS_INTEL_TOOL_NAMES) {
    const spec = buildBrainToolSpec(name, transport);
    registry.register(spec);
  }

  return Object.freeze({
    registry,
    toolNames: PROCESS_INTEL_TOOL_NAMES,
    transport,
    async close(): Promise<void> {
      if (transport) await transport.close();
    },
  });
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function resolveTransport(
  config: ProcessIntelBindingConfig,
): McpClientTransport | null {
  if (config.transport) return config.transport;
  const url = config.url ?? process.env.MCP_PROCESS_INTEL_URL?.trim();
  if (!url) return null;
  return createHttpMcpTransport(url);
}

function buildBrainToolSpec(
  name: ProcessIntelToolName,
  transport: McpClientTransport | null,
): BrainToolSpec<unknown, unknown> {
  const schemaIn = SCHEMA_BY_NAME[name];
  return Object.freeze({
    name,
    description: `Process Intel (MCP) — ${name}. Delegates to the pm4py sidecar in the mcp-server-process-intel container. See README.md in services/mcp-server-process-intel/ for schemas.`,
    schemaIn,
    schemaOut: z.unknown(),
    tier: 'pro' as const,
    requiresApproval: false,
    async executor(input: unknown): Promise<unknown> {
      if (!transport) {
        return {
          ok: false,
          errorCode: 'NOT_IMPLEMENTED',
          error:
            'MCP_PROCESS_INTEL_URL not configured — start the mcp-server-process-intel service to enable this tool',
        };
      }
      const args = input as Readonly<Record<string, unknown>>;
      const result = await transport.callTool(name, args);
      return decodeMcpResult(name, result);
    },
  });
}

function decodeMcpResult(
  toolName: string,
  result: McpToolCallResult,
): unknown {
  if (result.isError) {
    return {
      ok: false,
      errorCode: 'MCP_TOOL_ERROR',
      error: result.content?.[0]?.text ?? `MCP tool ${toolName} returned isError`,
    };
  }
  const text = result.content?.[0]?.text;
  if (typeof text !== 'string') {
    return { ok: false, errorCode: 'EMPTY_CONTENT', error: 'MCP tool returned no text' };
  }
  try {
    return JSON.parse(text);
  } catch {
    return { ok: true, raw: text };
  }
}

// ---------------------------------------------------------------------------
// HTTP transport — lightweight POST-per-call wrapper. Production-grade
// MCP-over-HTTP (SSE streaming, session ids, etc.) can be swapped in
// later; this minimal shape is enough for the tools we expose.
// ---------------------------------------------------------------------------

function createHttpMcpTransport(baseUrl: string): McpClientTransport {
  const url = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  return {
    async callTool(name, args): Promise<McpToolCallResult> {
      const response = await fetch(`${url}/mcp/tools/call`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, arguments: args }),
      });
      if (!response.ok) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `MCP transport returned HTTP ${response.status}`,
            },
          ],
        };
      }
      const json = (await response.json()) as McpToolCallResult;
      return json;
    },
    async close(): Promise<void> {
      // HTTP is stateless — nothing to release here.
    },
  };
}

// Re-export so other composition files can hook into the tool-name list
export { PROCESS_INTEL_TOOL_NAMES, type ProcessIntelToolName };
