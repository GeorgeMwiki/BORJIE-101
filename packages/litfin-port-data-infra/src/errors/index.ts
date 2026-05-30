/**
 * @borjie/litfin-port-data-infra/errors — canonical error code table.
 *
 * Ported from @litfin/errors. Stable error-code surface for the LITFIN-
 * pattern integration layer: webhook + idempotency + tenant boundary +
 * optimistic concurrency + audit-chain violations. Borjie's domain-
 * specific errors live in their respective packages; THIS surface is
 * the cross-cutting catalogue.
 */

export type LitFinPortErrorCode =
  | "TENANT_ISOLATION_VIOLATION"
  | "TENANT_BOUNDARY_VIOLATION"
  | "OPTIMISTIC_CONCURRENCY"
  | "TENANT_CONTEXT_REQUIRED"
  | "MISSING_TENANT_PREFIX"
  | "AUDIT_CHAIN_BREAK"
  | "INVALID_EVENT_TYPE"
  | "RATE_LIMIT_EXCEEDED"
  | "IDEMPOTENCY_KEY_REQUIRED"
  | "IDEMPOTENCY_KEY_CONFLICT"
  | "WEBHOOK_SIGNATURE_INVALID"
  | "INTERNAL_ERROR";

export interface LitFinPortErrorResponse {
  readonly code: LitFinPortErrorCode;
  readonly message: string;
  readonly retryable: boolean;
  readonly httpStatus: number;
  readonly details?: Record<string, unknown>;
}

const ERROR_TABLE: Record<
  LitFinPortErrorCode,
  Omit<LitFinPortErrorResponse, "code" | "details">
> = {
  TENANT_ISOLATION_VIOLATION: {
    message: "Tenant isolation violation",
    retryable: false,
    httpStatus: 403,
  },
  TENANT_BOUNDARY_VIOLATION: {
    message: "Tenant boundary crossed on stream append",
    retryable: false,
    httpStatus: 403,
  },
  OPTIMISTIC_CONCURRENCY: {
    message: "Another writer modified the stream; please retry",
    retryable: true,
    httpStatus: 409,
  },
  TENANT_CONTEXT_REQUIRED: {
    message: "Caller did not present a valid tenant context",
    retryable: false,
    httpStatus: 401,
  },
  MISSING_TENANT_PREFIX: {
    message: "Cache / storage key missing tenant prefix",
    retryable: false,
    httpStatus: 500,
  },
  AUDIT_CHAIN_BREAK: {
    message: "Audit chain continuity broken",
    retryable: false,
    httpStatus: 422,
  },
  INVALID_EVENT_TYPE: {
    message: "Event type not in the registered closed set",
    retryable: false,
    httpStatus: 400,
  },
  RATE_LIMIT_EXCEEDED: {
    message: "Rate limit exceeded; please slow down",
    retryable: true,
    httpStatus: 429,
  },
  IDEMPOTENCY_KEY_REQUIRED: {
    message: "Idempotency-Key header is required for this operation",
    retryable: false,
    httpStatus: 400,
  },
  IDEMPOTENCY_KEY_CONFLICT: {
    message: "Idempotency-Key already used with a different payload",
    retryable: false,
    httpStatus: 409,
  },
  WEBHOOK_SIGNATURE_INVALID: {
    message: "Webhook signature did not verify",
    retryable: false,
    httpStatus: 401,
  },
  INTERNAL_ERROR: {
    message: "Internal error; please try again later",
    retryable: true,
    httpStatus: 500,
  },
};

export function createLitFinPortError(
  code: LitFinPortErrorCode,
  details?: Record<string, unknown>,
): LitFinPortErrorResponse {
  const base = ERROR_TABLE[code];
  return Object.freeze({
    code,
    message: base.message,
    retryable: base.retryable,
    httpStatus: base.httpStatus,
    ...(details ? { details: Object.freeze({ ...details }) } : {}),
  });
}

export function getErrorHttpStatus(code: LitFinPortErrorCode): number {
  return ERROR_TABLE[code].httpStatus;
}

export function isRetryableError(code: LitFinPortErrorCode): boolean {
  return ERROR_TABLE[code].retryable;
}
