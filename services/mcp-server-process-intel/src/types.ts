/**
 * @borjie/mcp-server-process-intel — shared types.
 *
 * The MCP tools defined under `./tools/` all conform to the
 * `ProcessIntelTool` shape, which is a thin TypeScript surface above
 * the formal MCP `Tool` shape from `@modelcontextprotocol/sdk`.
 *
 * Each tool ships an `inputSchema` (JSON-Schema) so external MCP
 * clients can discover its parameters, an `outputSchema` (informational
 * only — MCP does not validate outputs), and an `execute()` that
 * dispatches to the pm4py Python sidecar through `Pm4pyClient`.
 *
 * All types are readonly / immutable: handlers never mutate input.
 */

import type { Pm4pyClient } from './pm4py-client.js';

// ---------------------------------------------------------------------------
// JSON-Schema (minimal subset used by tool descriptors)
//
// We keep `type` as `string` (not a string-literal union) so concrete
// tool files can write `type: 'object'` without needing `as const` on
// every literal. Validation is the MCP client's job — we only need
// the shape advertised in `tools/list` to be JSON-Schema-shaped.
// ---------------------------------------------------------------------------

export interface JsonSchemaProperty {
  readonly type: string;
  readonly description?: string;
  readonly format?: string;
  readonly enum?: ReadonlyArray<string | number>;
  readonly items?: unknown;
  readonly properties?: Readonly<Record<string, unknown>>;
  readonly required?: ReadonlyArray<string>;
  readonly additionalProperties?: boolean | unknown;
  readonly minimum?: number;
  readonly maximum?: number;
}

export interface JsonSchemaObject {
  readonly type: string;
  readonly properties: Readonly<Record<string, JsonSchemaProperty>>;
  readonly required?: ReadonlyArray<string>;
  readonly additionalProperties?: boolean;
}

// ---------------------------------------------------------------------------
// Tool descriptor — what the MCP server advertises + executes
//
// The `input` parameter is intentionally typed `unknown` so the
// registry can hold a heterogeneous list (each tool has its own
// concrete input/output types). Tool-level callers pass the typed
// `I` shape; the executor casts internally.
// ---------------------------------------------------------------------------

export interface ProcessIntelTool<O = unknown> {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: JsonSchemaObject;
  readonly outputSchema: JsonSchemaObject;
  readonly execute: (input: unknown, deps: ToolDeps) => Promise<O>;
}

export interface ToolDeps {
  readonly pm4py: Pm4pyClient;
}

// ---------------------------------------------------------------------------
// Event-log shapes — what the pm4py sidecar consumes
// ---------------------------------------------------------------------------

export interface EventLogRecord {
  readonly caseId: string;
  readonly activity: string;
  readonly timestamp: string; // ISO-8601
  readonly resource?: string;
  readonly attributes?: Readonly<Record<string, string | number | boolean>>;
}

export interface EventLogBatch {
  readonly tenantId: string;
  readonly processId: string;
  readonly events: ReadonlyArray<EventLogRecord>;
}

// ---------------------------------------------------------------------------
// Sidecar transport
// ---------------------------------------------------------------------------

export type Pm4pyCommandKind =
  | 'get_processes'
  | 'get_bottleneck_analysis'
  | 'get_variants_with_metrics'
  | 'get_correlation'
  | 'get_conformance'
  | 'get_loop_analysis'
  | 'get_handoff_matrix'
  | 'get_cycle_time_distribution'
  | 'get_drift_alerts';

export interface Pm4pyCommand {
  readonly id: string;
  readonly kind: Pm4pyCommandKind;
  readonly args: Readonly<Record<string, unknown>>;
}

export interface Pm4pyResponse {
  readonly id: string;
  readonly ok: boolean;
  readonly data?: unknown;
  readonly error?: string;
  readonly errorCode?: string;
}

export class Pm4pySidecarError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'Pm4pySidecarError';
  }
}
