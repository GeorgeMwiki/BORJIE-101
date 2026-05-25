/**
 * MCP wire types — JSON-RPC 2.0 envelopes + protocol-specific payloads.
 *
 * We implement the protocol directly (not via @modelcontextprotocol/sdk) so we
 * own the session, audit, and tenant-scoping surface. Spec baseline:
 * `2026-04` (date-keyed protocol-version string per the convention introduced
 * with `2024-11-05` and stepped at `2025-03-26`, `2025-09-01`, `2026-04-01`).
 *
 * See `Docs/MCP_SOTA_RESEARCH_2026-05-24.md` for the rationale behind the
 * choices encoded here.
 */

import type { z } from 'zod';

/**
 * Latest protocol version this package implements. Clients/servers negotiate
 * the highest mutually-supported version at `initialize`.
 */
export const PROTOCOL_VERSION = '2026-04-01' as const;
export type ProtocolVersion = string;

/**
 * Known historical revisions we are compatible with (in descending order).
 * The client sends `PROTOCOL_VERSION`; the server replies with the highest
 * version *it* supports that is ≤ what the client asked for, picking from
 * this list if it doesn't have a more recent one.
 */
export const KNOWN_PROTOCOL_VERSIONS: ReadonlyArray<string> = [
  '2026-04-01',
  '2025-09-01',
  '2025-03-26',
  '2024-11-05',
];

// ──────────────────────────────────────────────────────────────────────────────
// JSON-RPC 2.0 envelopes
// ──────────────────────────────────────────────────────────────────────────────

export interface JSONRPCRequest {
  readonly jsonrpc: '2.0';
  readonly id: number | string;
  readonly method: string;
  readonly params?: unknown;
}

export interface JSONRPCResponse<T = unknown> {
  readonly jsonrpc: '2.0';
  readonly id: number | string;
  readonly result: T;
}

export interface JSONRPCError {
  readonly jsonrpc: '2.0';
  readonly id: number | string | null;
  readonly error: {
    readonly code: number;
    readonly message: string;
    readonly data?: unknown;
  };
}

export interface JSONRPCNotification {
  readonly jsonrpc: '2.0';
  readonly method: string;
  readonly params?: unknown;
}

export type MCPMessage =
  | JSONRPCRequest
  | JSONRPCResponse
  | JSONRPCError
  | JSONRPCNotification;

/** Standard JSON-RPC + MCP error codes. */
export const ErrorCodes = {
  // JSON-RPC 2.0
  ParseError: -32700,
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  InternalError: -32603,
  // MCP-specific
  ConnectionClosed: -32000,
  RequestTimeout: -32001,
  Unauthorized: -32002,
  TenantScopeViolation: -32003,
  CapabilityNotSupported: -32004,
} as const;

// ──────────────────────────────────────────────────────────────────────────────
// Initialize handshake
// ──────────────────────────────────────────────────────────────────────────────

export interface ClientInfo {
  readonly name: string;
  readonly version: string;
}

export interface ServerInfo {
  readonly name: string;
  readonly version: string;
  readonly description?: string;
}

export interface ClientCapabilities {
  readonly sampling?: Record<string, unknown>;
  readonly roots?: { readonly listChanged?: boolean };
  readonly experimental?: Record<string, unknown>;
}

export interface ServerCapabilities {
  readonly tools?: { readonly listChanged?: boolean };
  readonly resources?: {
    readonly subscribe?: boolean;
    readonly listChanged?: boolean;
  };
  readonly prompts?: { readonly listChanged?: boolean };
  readonly logging?: Record<string, unknown>;
  readonly experimental?: Record<string, unknown>;
}

export interface InitializeRequest {
  readonly protocolVersion: ProtocolVersion;
  readonly clientInfo: ClientInfo;
  readonly capabilities: ClientCapabilities;
}

export interface InitializeResponse {
  readonly protocolVersion: ProtocolVersion;
  readonly serverInfo: ServerInfo;
  readonly capabilities: ServerCapabilities;
  /** Optional human-readable instructions for the client. */
  readonly instructions?: string;
}

// ──────────────────────────────────────────────────────────────────────────────
// Tools
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Tool annotations per spec 2025-03-26+. Hints — not enforced by the
 * protocol; clients/policy engines use them to gate auto-execution.
 */
export interface ToolAnnotations {
  /** Human-readable title for the tool (overrides `name` in UIs). */
  readonly title?: string;
  /** Tool does not modify any state. Safe to auto-invoke. */
  readonly readOnlyHint?: boolean;
  /** Tool performs destructive updates (delete/refund/cancel). */
  readonly destructiveHint?: boolean;
  /** Same args ⇒ same result. Enables idempotent retry. */
  readonly idempotentHint?: boolean;
  /** Tool reaches services outside the client's control (web, 3rd-party). */
  readonly openWorldHint?: boolean;
}

export interface Tool {
  readonly name: string;
  readonly description: string;
  /** JSON-Schema. Our framework derives this from a zod schema. */
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly annotations?: ToolAnnotations;
}

/** Content block returned from a tool call. */
export type ContentBlock =
  | { readonly type: 'text'; readonly text: string }
  | {
      readonly type: 'image';
      readonly data: string; // base64
      readonly mimeType: string;
    }
  | {
      readonly type: 'audio';
      readonly data: string;
      readonly mimeType: string;
    }
  | {
      readonly type: 'resource';
      readonly resource: {
        readonly uri: string;
        readonly mimeType?: string;
        readonly text?: string;
        readonly blob?: string;
      };
    };

export interface ToolCallRequest {
  readonly name: string;
  readonly arguments?: Record<string, unknown>;
}

export interface ToolCallResponse {
  readonly content: ReadonlyArray<ContentBlock>;
  readonly isError?: boolean;
}

// ──────────────────────────────────────────────────────────────────────────────
// Resources
// ──────────────────────────────────────────────────────────────────────────────

export interface Resource {
  readonly uri: string;
  readonly name: string;
  readonly description?: string;
  readonly mimeType?: string;
}

export interface ResourceContent {
  readonly uri: string;
  readonly mimeType?: string;
  readonly text?: string;
  readonly blob?: string;
}

// ──────────────────────────────────────────────────────────────────────────────
// Prompts
// ──────────────────────────────────────────────────────────────────────────────

export interface PromptArgument {
  readonly name: string;
  readonly description?: string;
  readonly required?: boolean;
}

export interface Prompt {
  readonly name: string;
  readonly description?: string;
  readonly arguments?: ReadonlyArray<PromptArgument>;
}

export interface PromptMessage {
  readonly role: 'user' | 'assistant' | 'system';
  readonly content: ContentBlock;
}

export interface GetPromptResponse {
  readonly description?: string;
  readonly messages: ReadonlyArray<PromptMessage>;
}

// ──────────────────────────────────────────────────────────────────────────────
// Sampling (server-initiated LLM calls — rare; opt-in per server)
// ──────────────────────────────────────────────────────────────────────────────

export interface SamplingMessage {
  readonly role: 'user' | 'assistant';
  readonly content: ContentBlock;
}

export interface ModelPreferences {
  readonly hints?: ReadonlyArray<{ readonly name?: string }>;
  readonly costPriority?: number;
  readonly speedPriority?: number;
  readonly intelligencePriority?: number;
}

export interface CreateMessageRequest {
  readonly messages: ReadonlyArray<SamplingMessage>;
  readonly modelPreferences?: ModelPreferences;
  readonly systemPrompt?: string;
  readonly maxTokens: number;
}

export interface CreateMessageResponse {
  readonly role: 'assistant';
  readonly content: ContentBlock;
  readonly model: string;
  readonly stopReason?: string;
}

// ──────────────────────────────────────────────────────────────────────────────
// Notifications
// ──────────────────────────────────────────────────────────────────────────────

export type NotificationMethod =
  | 'notifications/initialized'
  | 'notifications/progress'
  | 'notifications/message'
  | 'notifications/resources/list_changed'
  | 'notifications/resources/updated'
  | 'notifications/tools/list_changed'
  | 'notifications/prompts/list_changed';

export interface ProgressNotification {
  readonly progressToken: string | number;
  readonly progress: number;
  readonly total?: number;
}

export interface LogNotification {
  readonly level: 'debug' | 'info' | 'notice' | 'warning' | 'error';
  readonly logger?: string;
  readonly data: unknown;
}

// ──────────────────────────────────────────────────────────────────────────────
// Transport
// ──────────────────────────────────────────────────────────────────────────────

export interface TransportPort {
  /** Send a single JSON-RPC frame. Resolves when the frame is queued. */
  send(message: MCPMessage): Promise<void>;
  /**
   * Subscribe to inbound frames. Returns an unsubscribe handle.
   * Multiple subscribers fan out — last subscriber wins on backpressure.
   */
  onMessage(handler: (message: MCPMessage) => void): () => void;
  /** Subscribe to transport errors (connection drops, parse failures). */
  onError(handler: (error: Error) => void): () => void;
  /** Subscribe to transport close events (clean or unclean). */
  onClose(handler: () => void): () => void;
  /** Close the transport. Idempotent. */
  close(): Promise<void>;
  /** True between successful open and close. */
  readonly isOpen: boolean;
}

// ──────────────────────────────────────────────────────────────────────────────
// Tenant scope + session
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Session-scoped context attached to every inbound tool/resource/prompt call.
 * `tenantId` is set at session creation (from auth/headers/env) and is the
 * *only* trusted source. Tool handlers must not accept `tenantId` from args.
 */
export interface SessionContext {
  readonly sessionId: string;
  readonly tenantId: string;
  readonly principalId?: string;
  readonly correlationId?: string;
  /** Arbitrary additional headers/auth metadata. */
  readonly meta?: Readonly<Record<string, string>>;
}

// ──────────────────────────────────────────────────────────────────────────────
// Audit port
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Minimal audit port. We don't pull `@borjie/observability` in because
 * that would create a heavy dependency edge; instead consumers inject a port
 * that adapts to whichever audit store they use.
 */
export interface AuditEvent {
  readonly tenantId: string;
  readonly sessionId: string;
  readonly action: string; // e.g. "mcp.tool.call"
  readonly target: string; // e.g. "tool:list_properties"
  readonly outcome: 'success' | 'failure' | 'denied';
  readonly principalId?: string;
  readonly correlationId?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly timestamp: number;
}

export interface AuditPort {
  append(event: AuditEvent): void | Promise<void>;
}

// ──────────────────────────────────────────────────────────────────────────────
// Tool / resource / prompt definitions (server-side)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Server-side tool definition. `inputSchema` is a zod schema; the framework
 * generates the JSON-Schema for the wire and validates inputs before calling
 * the handler.
 */
export interface ToolDefinition<TInput = unknown, TOutput = unknown> {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: z.ZodType<TInput>;
  readonly annotations?: ToolAnnotations;
  /**
   * Handler. Receives the validated args + session context. Return either a
   * string (sugar for a single text content block) or an explicit
   * `ToolCallResponse`.
   */
  handler: (
    args: TInput,
    ctx: SessionContext,
  ) => Promise<TOutput | string | ToolCallResponse>;
}

export interface ResourceDefinition {
  readonly uri: string;
  readonly name: string;
  readonly description?: string;
  readonly mimeType?: string;
  /** Returns content for the resource. May filter by tenant. */
  contentProvider: (
    ctx: SessionContext,
  ) => Promise<ResourceContent | ReadonlyArray<ResourceContent>>;
}

export interface PromptDefinition<TArgs = Record<string, unknown>> {
  readonly name: string;
  readonly description?: string;
  readonly argsSchema?: z.ZodType<TArgs>;
  readonly arguments?: ReadonlyArray<PromptArgument>;
  render: (
    args: TArgs,
    ctx: SessionContext,
  ) => Promise<GetPromptResponse> | GetPromptResponse;
}

// ──────────────────────────────────────────────────────────────────────────────
// Typed errors
// ──────────────────────────────────────────────────────────────────────────────

export class MCPError extends Error {
  constructor(
    message: string,
    readonly code: number,
    readonly data?: unknown,
  ) {
    super(message);
    this.name = 'MCPError';
  }
}

export class MCPBackpressureError extends MCPError {
  constructor(message = 'Transport send queue is full') {
    super(message, ErrorCodes.InternalError);
    this.name = 'MCPBackpressureError';
  }
}

export class MCPTimeoutError extends MCPError {
  constructor(method: string, timeoutMs: number) {
    super(
      `MCP request '${method}' timed out after ${timeoutMs}ms`,
      ErrorCodes.RequestTimeout,
    );
    this.name = 'MCPTimeoutError';
  }
}

export class MCPClosedError extends MCPError {
  constructor(message = 'MCP connection is closed') {
    super(message, ErrorCodes.ConnectionClosed);
    this.name = 'MCPClosedError';
  }
}

export class TenantScopeError extends MCPError {
  constructor(
    message: string,
    readonly attemptedTenant?: string,
    readonly sessionTenant?: string,
  ) {
    super(message, ErrorCodes.TenantScopeViolation);
    this.name = 'TenantScopeError';
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Convenience: type guards
// ──────────────────────────────────────────────────────────────────────────────

export function isRequest(msg: MCPMessage): msg is JSONRPCRequest {
  return (
    'id' in msg &&
    'method' in msg &&
    !('result' in msg) &&
    !('error' in msg) &&
    msg.id !== undefined
  );
}

export function isResponse(msg: MCPMessage): msg is JSONRPCResponse {
  return 'id' in msg && 'result' in msg;
}

export function isErrorResponse(msg: MCPMessage): msg is JSONRPCError {
  return 'id' in msg && 'error' in msg;
}

export function isNotification(msg: MCPMessage): msg is JSONRPCNotification {
  return 'method' in msg && !('id' in msg);
}
