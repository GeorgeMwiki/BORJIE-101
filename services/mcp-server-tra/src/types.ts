/**
 * @borjie/mcp-server-tra — shared types.
 *
 * MCP tool descriptor + JSON-Schema shapes used by `tools/list` and
 * dispatched by `tools/call`. The HTTP transport (Hono) and the stdio
 * transport (`@modelcontextprotocol/sdk`) both consume this list.
 *
 * All payloads are immutable; tool implementations never mutate input.
 */

import type { z } from 'zod';

export interface JsonSchemaProperty {
  readonly type: string;
  readonly description?: string;
  readonly format?: string;
  readonly enum?: ReadonlyArray<string | number | boolean>;
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

export interface TraTool<I = unknown, O = unknown> {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: JsonSchemaObject;
  readonly outputSchema: JsonSchemaObject;
  readonly zodInput: z.ZodTypeAny;
  readonly zodOutput: z.ZodTypeAny;
  readonly execute: (input: I) => Promise<O>;
}

export type AnyTraTool = TraTool<unknown, unknown>;
