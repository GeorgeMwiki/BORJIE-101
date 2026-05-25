/**
 * Tests for error-codes.ts — full matrix of HTTP statuses, retryability,
 * envelope construction, and override semantics.
 */
import { describe, expect, it } from 'vitest';
import {
  createAgentError,
  getErrorHttpStatus,
  isRetryableError,
  type AgentErrorCode,
} from '../error-codes.js';

describe('createAgentError envelope', () => {
  it('omits retryAfterMs for codes without one', () => {
    const err = createAgentError('AUTH_REQUIRED');
    expect(err.errorCode).toBe('AUTH_REQUIRED');
    expect(err.retryable).toBe(false);
    expect((err as { retryAfterMs?: number }).retryAfterMs).toBeUndefined();
  });

  it('includes retryAfterMs for retryable codes that define one', () => {
    const err = createAgentError('UPSTREAM_TIMEOUT');
    expect(err.retryAfterMs).toBe(10_000);
  });

  it('uses defaultMessage when no override is provided', () => {
    const err = createAgentError('VALIDATION_FAILED');
    expect(err.error).toBe('Request validation failed.');
  });

  it('applies overrideMessage when supplied', () => {
    const err = createAgentError('VALIDATION_FAILED', undefined, 'custom msg');
    expect(err.error).toBe('custom msg');
  });

  it('attaches frozen details when provided', () => {
    const err = createAgentError('TOOL_INVALID_INPUT', { field: 'rent' });
    expect((err as { details?: Record<string, unknown> }).details).toEqual({ field: 'rent' });
  });

  it('omits details when not provided', () => {
    const err = createAgentError('TOOL_INVALID_INPUT');
    expect((err as { details?: Record<string, unknown> }).details).toBeUndefined();
  });

  it('omits correlationId when not supplied', () => {
    const err = createAgentError('INTERNAL_ERROR');
    expect((err as { correlationId?: string }).correlationId).toBeUndefined();
  });

  it('attaches correlationId when supplied', () => {
    const err = createAgentError('INTERNAL_ERROR', undefined, undefined, 'cid-7');
    expect((err as { correlationId?: string }).correlationId).toBe('cid-7');
  });

  it('returns a frozen object (immutability)', () => {
    const err = createAgentError('AUTH_REQUIRED');
    expect(Object.isFrozen(err)).toBe(true);
  });

  it('always sets ok=false', () => {
    const err = createAgentError('SERVICE_UNAVAILABLE');
    expect(err.ok).toBe(false);
  });
});

describe('getErrorHttpStatus matrix', () => {
  const cases: ReadonlyArray<[AgentErrorCode, number]> = [
    ['AUTH_REQUIRED', 401],
    ['AUTH_INVALID_KEY', 401],
    ['AUTH_INVALID_SIGNATURE', 401],
    ['AUTH_REVOKED_AGENT', 401],
    ['AUTH_SUSPENDED_AGENT', 401],
    ['AUTH_SCOPE_DENIED', 403],
    ['AUTH_TENANT_MISMATCH', 403],
    ['RATE_LIMIT_EXCEEDED', 429],
    ['IDEMPOTENCY_CONFLICT', 409],
    ['VALIDATION_FAILED', 400],
    ['INVALID_REQUEST_BODY', 400],
    ['MISSING_REQUIRED_FIELD', 400],
    ['INVALID_EVENT_TYPE', 400],
    ['AGENT_NOT_FOUND', 404],
    ['SUBSCRIPTION_NOT_FOUND', 404],
    ['TOOL_NOT_FOUND', 404],
    ['TOOL_EXECUTION_FAILED', 500],
    ['TOOL_PERMISSION_DENIED', 403],
    ['TOOL_TIMEOUT', 504],
    ['TOOL_INVALID_INPUT', 400],
    ['WEBHOOK_DELIVERY_FAILED', 500],
    ['WEBHOOK_URL_UNREACHABLE', 502],
    ['WEBHOOK_SIGNATURE_MISMATCH', 400],
    ['WEBHOOK_SUBSCRIPTION_PAUSED', 409],
    ['INTERNAL_ERROR', 500],
    ['SERVICE_UNAVAILABLE', 503],
    ['UPSTREAM_TIMEOUT', 504],
    ['DATABASE_ERROR', 500],
  ];

  for (const [code, status] of cases) {
    it(`${code} → ${status}`, () => {
      expect(getErrorHttpStatus(code)).toBe(status);
    });
  }
});

describe('isRetryableError', () => {
  it('marks all auth and validation errors as non-retryable', () => {
    const nonRetryable: AgentErrorCode[] = [
      'AUTH_REQUIRED',
      'AUTH_INVALID_KEY',
      'AUTH_INVALID_SIGNATURE',
      'AUTH_SCOPE_DENIED',
      'IDEMPOTENCY_CONFLICT',
      'VALIDATION_FAILED',
      'TOOL_INVALID_INPUT',
      'WEBHOOK_SIGNATURE_MISMATCH',
    ];
    for (const c of nonRetryable) expect(isRetryableError(c)).toBe(false);
  });

  it('marks server / upstream timeouts as retryable', () => {
    const retryable: AgentErrorCode[] = [
      'RATE_LIMIT_EXCEEDED',
      'TOOL_EXECUTION_FAILED',
      'TOOL_TIMEOUT',
      'WEBHOOK_DELIVERY_FAILED',
      'WEBHOOK_URL_UNREACHABLE',
      'INTERNAL_ERROR',
      'SERVICE_UNAVAILABLE',
      'UPSTREAM_TIMEOUT',
      'DATABASE_ERROR',
    ];
    for (const c of retryable) expect(isRetryableError(c)).toBe(true);
  });
});
