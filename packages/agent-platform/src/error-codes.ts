/**
 * Agent Platform — Structured Error Codes
 *
 * Machine-readable error codes for external agents. The envelope includes
 * a `retryable` flag so agents can drive their retry logic from a single
 * field rather than parsing error messages.
 */

import type { AgentErrorResponse } from './types.js';

export type AgentErrorCode =
  // Auth
  | 'AUTH_REQUIRED'
  | 'AUTH_INVALID_KEY'
  | 'AUTH_INVALID_SIGNATURE'
  | 'AUTH_REVOKED_AGENT'
  | 'AUTH_SUSPENDED_AGENT'
  | 'AUTH_SCOPE_DENIED'
  | 'AUTH_TENANT_MISMATCH'
  // Rate limiting
  | 'RATE_LIMIT_EXCEEDED'
  // Idempotency
  | 'IDEMPOTENCY_CONFLICT'
  // Validation
  | 'VALIDATION_FAILED'
  | 'INVALID_REQUEST_BODY'
  | 'MISSING_REQUIRED_FIELD'
  | 'INVALID_EVENT_TYPE'
  // Not found
  | 'AGENT_NOT_FOUND'
  | 'SUBSCRIPTION_NOT_FOUND'
  | 'TOOL_NOT_FOUND'
  // Tool execution
  | 'TOOL_EXECUTION_FAILED'
  | 'TOOL_PERMISSION_DENIED'
  | 'TOOL_TIMEOUT'
  | 'TOOL_INVALID_INPUT'
  // Webhook
  | 'WEBHOOK_DELIVERY_FAILED'
  | 'WEBHOOK_URL_UNREACHABLE'
  | 'WEBHOOK_SIGNATURE_MISMATCH'
  | 'WEBHOOK_SUBSCRIPTION_PAUSED'
  // Server
  | 'INTERNAL_ERROR'
  | 'SERVICE_UNAVAILABLE'
  | 'UPSTREAM_TIMEOUT'
  | 'DATABASE_ERROR';

interface ErrorMeta {
  readonly httpStatus: number;
  readonly retryable: boolean;
  readonly defaultMessage: string;
  readonly retryAfterMs?: number;
}

const ERROR_METADATA: Readonly<Record<AgentErrorCode, ErrorMeta>> = {
  AUTH_REQUIRED: {
    httpStatus: 401,
    retryable: false,
    defaultMessage: 'Authentication required.',
  },
  AUTH_INVALID_KEY: {
    httpStatus: 401,
    retryable: false,
    defaultMessage: 'Invalid API key.',
  },
  AUTH_INVALID_SIGNATURE: {
    httpStatus: 401,
    retryable: false,
    defaultMessage: 'HMAC signature verification failed.',
  },
  AUTH_REVOKED_AGENT: {
    httpStatus: 401,
    retryable: false,
    defaultMessage: 'Agent has been revoked.',
  },
  AUTH_SUSPENDED_AGENT: {
    httpStatus: 401,
    retryable: false,
    defaultMessage: 'Agent is suspended.',
  },
  AUTH_SCOPE_DENIED: {
    httpStatus: 403,
    retryable: false,
    defaultMessage: 'Agent lacks required scopes.',
  },
  AUTH_TENANT_MISMATCH: {
    httpStatus: 403,
    retryable: false,
    defaultMessage: 'Agent cannot access requested tenant.',
  },
  RATE_LIMIT_EXCEEDED: {
    httpStatus: 429,
    retryable: true,
    defaultMessage: 'Rate limit exceeded.',
    retryAfterMs: 60_000,
  },
  IDEMPOTENCY_CONFLICT: {
    httpStatus: 409,
    retryable: false,
    defaultMessage:
      'Idempotency key already used with a different request body.',
  },
  VALIDATION_FAILED: {
    httpStatus: 400,
    retryable: false,
    defaultMessage: 'Request validation failed.',
  },
  INVALID_REQUEST_BODY: {
    httpStatus: 400,
    retryable: false,
    defaultMessage: 'Invalid request body.',
  },
  MISSING_REQUIRED_FIELD: {
    httpStatus: 400,
    retryable: false,
    defaultMessage: 'Required field is missing.',
  },
  INVALID_EVENT_TYPE: {
    httpStatus: 400,
    retryable: false,
    defaultMessage: 'Invalid event type.',
  },
  AGENT_NOT_FOUND: {
    httpStatus: 404,
    retryable: false,
    defaultMessage: 'Agent not found.',
  },
  SUBSCRIPTION_NOT_FOUND: {
    httpStatus: 404,
    retryable: false,
    defaultMessage: 'Webhook subscription not found.',
  },
  TOOL_NOT_FOUND: {
    httpStatus: 404,
    retryable: false,
    defaultMessage: 'Tool not found.',
  },
  TOOL_EXECUTION_FAILED: {
    httpStatus: 500,
    retryable: true,
    defaultMessage: 'Tool execution failed.',
    retryAfterMs: 5_000,
  },
  TOOL_PERMISSION_DENIED: {
    httpStatus: 403,
    retryable: false,
    defaultMessage: 'Tool permission denied.',
  },
  TOOL_TIMEOUT: {
    httpStatus: 504,
    retryable: true,
    defaultMessage: 'Tool execution timed out.',
    retryAfterMs: 10_000,
  },
  TOOL_INVALID_INPUT: {
    httpStatus: 400,
    retryable: false,
    defaultMessage: 'Invalid input for tool.',
  },
  WEBHOOK_DELIVERY_FAILED: {
    httpStatus: 500,
    retryable: true,
    defaultMessage: 'Webhook delivery failed.',
  },
  WEBHOOK_URL_UNREACHABLE: {
    httpStatus: 502,
    retryable: true,
    defaultMessage: 'Webhook URL is unreachable.',
    retryAfterMs: 30_000,
  },
  WEBHOOK_SIGNATURE_MISMATCH: {
    httpStatus: 400,
    retryable: false,
    defaultMessage: 'Webhook signature verification failed.',
  },
  WEBHOOK_SUBSCRIPTION_PAUSED: {
    httpStatus: 409,
    retryable: false,
    defaultMessage: 'Webhook subscription is paused.',
  },
  INTERNAL_ERROR: {
    httpStatus: 500,
    retryable: true,
    defaultMessage: 'Internal server error.',
    retryAfterMs: 5_000,
  },
  SERVICE_UNAVAILABLE: {
    httpStatus: 503,
    retryable: true,
    defaultMessage: 'Service temporarily unavailable.',
    retryAfterMs: 30_000,
  },
  UPSTREAM_TIMEOUT: {
    httpStatus: 504,
    retryable: true,
    defaultMessage: 'Upstream service timed out.',
    retryAfterMs: 10_000,
  },
  DATABASE_ERROR: {
    httpStatus: 500,
    retryable: true,
    defaultMessage: 'Database operation failed.',
    retryAfterMs: 5_000,
  },
};

export function createAgentError(
  code: AgentErrorCode,
  details?: Record<string, unknown>,
  overrideMessage?: string,
  correlationId?: string,
): AgentErrorResponse {
  const meta = ERROR_METADATA[code];
  const base = {
    ok: false as const,
    error: overrideMessage ?? meta.defaultMessage,
    errorCode: code,
    retryable: meta.retryable,
  };
  const extras: Record<string, unknown> = {};
  if (meta.retryAfterMs !== undefined) extras.retryAfterMs = meta.retryAfterMs;
  if (details) extras.details = Object.freeze({ ...details });
  if (correlationId !== undefined) extras.correlationId = correlationId;
  return Object.freeze({ ...base, ...extras }) as AgentErrorResponse;
}

export function getErrorHttpStatus(code: AgentErrorCode): number {
  return ERROR_METADATA[code].httpStatus;
}

export function isRetryableError(code: AgentErrorCode): boolean {
  return ERROR_METADATA[code].retryable;
}
