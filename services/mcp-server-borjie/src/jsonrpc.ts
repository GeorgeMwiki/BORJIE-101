/**
 * Minimal JSON-RPC 2.0 envelope used by the MCP protocol.
 *
 * We intentionally do not depend on `@modelcontextprotocol/sdk` here so
 * this service stays small and easy to audit. The protocol surface we
 * implement is a strict subset of MCP 2024-11-05:
 *
 *   initialize, tools/list, tools/call, resources/list, resources/read,
 *   prompts/list, prompts/get, ping.
 *
 * The MCP spec uses JSON-RPC 2.0 over either stdio (newline-delimited)
 * or HTTP (one request body, one response body).
 */

export interface JsonRpcRequest {
  readonly jsonrpc: '2.0';
  readonly id: string | number | null;
  readonly method: string;
  readonly params?: Readonly<Record<string, unknown>>;
}

export interface JsonRpcSuccess {
  readonly jsonrpc: '2.0';
  readonly id: string | number | null;
  readonly result: unknown;
}

export interface JsonRpcError {
  readonly jsonrpc: '2.0';
  readonly id: string | number | null;
  readonly error: {
    readonly code: number;
    readonly message: string;
    readonly data?: unknown;
  };
}

export type JsonRpcResponse = JsonRpcSuccess | JsonRpcError;

export const JSON_RPC_PARSE_ERROR = -32700;
export const JSON_RPC_INVALID_REQUEST = -32600;
export const JSON_RPC_METHOD_NOT_FOUND = -32601;
export const JSON_RPC_INVALID_PARAMS = -32602;
export const JSON_RPC_INTERNAL_ERROR = -32603;
export const JSON_RPC_UNAUTHORIZED = -32001;
export const JSON_RPC_FORBIDDEN = -32002;
export const JSON_RPC_KILL_SWITCH_OPEN = -32003;
export const JSON_RPC_SAMPLING_UNSUPPORTED = -32010;
export const JSON_RPC_APPROVAL_PENDING = -32011;
export const JSON_RPC_APPROVAL_DENIED = -32012;
export const JSON_RPC_APPROVAL_EXPIRED = -32013;
export const JSON_RPC_RATE_LIMIT_EXCEEDED = -32099;

/** Build a JSON-RPC notification envelope (id-less message). */
export interface JsonRpcNotification {
  readonly jsonrpc: '2.0';
  readonly method: string;
  readonly params?: Readonly<Record<string, unknown>>;
}

export function buildNotification(
  method: string,
  params?: Readonly<Record<string, unknown>>,
): JsonRpcNotification {
  return Object.freeze({
    jsonrpc: '2.0' as const,
    method,
    ...(params !== undefined ? { params } : {}),
  });
}

export function buildSuccess(
  id: string | number | null,
  result: unknown,
): JsonRpcSuccess {
  return Object.freeze({ jsonrpc: '2.0' as const, id, result });
}

export function buildError(
  id: string | number | null,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcError {
  return Object.freeze({
    jsonrpc: '2.0' as const,
    id,
    error: Object.freeze({
      code,
      message,
      ...(data !== undefined ? { data } : {}),
    }),
  });
}

export function isJsonRpcRequest(value: unknown): value is JsonRpcRequest {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v['jsonrpc'] !== '2.0') return false;
  if (typeof v['method'] !== 'string') return false;
  if (
    typeof v['id'] !== 'string' &&
    typeof v['id'] !== 'number' &&
    v['id'] !== null
  ) {
    return false;
  }
  return true;
}

export function parseJsonRpcLine(line: string): JsonRpcRequest | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (!isJsonRpcRequest(parsed)) return null;
  return parsed;
}
