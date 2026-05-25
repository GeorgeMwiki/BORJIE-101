/**
 * Safe-error helpers — Wave 19 Agent H+I.
 *
 * Regression coverage for the prod-message scrubber, the SQL-error mapper,
 * and the `routeCatch` envelope. These tests would have caught the Wave 19
 * leaks where router catch blocks echoed raw Postgres driver strings to
 * clients.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('scrubMessage', () => {
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
    vi.resetModules();
  });

  it('returns the raw message in development for debuggability', async () => {
    process.env.NODE_ENV = 'development';
    const { scrubMessage } = await import('../utils/safe-error');
    const err = new Error('duplicate key value violates unique constraint "idx_customer_email"');
    expect(scrubMessage(err)).toBe(
      'duplicate key value violates unique constraint "idx_customer_email"',
    );
  });

  it('returns the fallback in production so constraint names cannot leak', async () => {
    process.env.NODE_ENV = 'production';
    const { scrubMessage } = await import('../utils/safe-error');
    const err = new Error('duplicate key value violates unique constraint "idx_customer_email"');
    expect(scrubMessage(err, 'Customer create failed')).toBe('Customer create failed');
  });

  it('never surfaces stack frames even in dev', async () => {
    process.env.NODE_ENV = 'development';
    const { scrubMessage } = await import('../utils/safe-error');
    const err = new Error('boom');
    expect(scrubMessage(err)).not.toContain('at ');
    expect(scrubMessage(err)).not.toContain('.ts:');
  });
});

describe('mapSqlError', () => {
  it('maps 23505 (unique_violation) to 409 DUPLICATE_ENTRY', async () => {
    const { mapSqlError } = await import('../utils/safe-error');
    const mapped = mapSqlError({ code: '23505', constraint: 'idx_foo' });
    expect(mapped).toEqual({
      status: 409,
      code: 'DUPLICATE_ENTRY',
      message: 'A record with these values already exists.',
    });
  });

  it('maps 23503 (foreign_key_violation) to 409 FOREIGN_KEY_VIOLATION', async () => {
    const { mapSqlError } = await import('../utils/safe-error');
    const mapped = mapSqlError({ code: '23503' });
    expect(mapped?.status).toBe(409);
    expect(mapped?.code).toBe('FOREIGN_KEY_VIOLATION');
  });

  it('maps 23502 (not_null_violation) to 400 MISSING_REQUIRED_FIELD', async () => {
    const { mapSqlError } = await import('../utils/safe-error');
    const mapped = mapSqlError({ code: '23502' });
    expect(mapped?.status).toBe(400);
    expect(mapped?.code).toBe('MISSING_REQUIRED_FIELD');
  });

  it('maps 22P02 (invalid_text_representation) to 400 INVALID_INPUT_FORMAT', async () => {
    const { mapSqlError } = await import('../utils/safe-error');
    const mapped = mapSqlError({ code: '22P02' });
    expect(mapped?.status).toBe(400);
    expect(mapped?.code).toBe('INVALID_INPUT_FORMAT');
  });

  it('returns null for unrecognised codes (caller falls through to 500)', async () => {
    const { mapSqlError } = await import('../utils/safe-error');
    expect(mapSqlError({ code: 'XX999' })).toBeNull();
    expect(mapSqlError(new Error('no code'))).toBeNull();
    expect(mapSqlError(null)).toBeNull();
  });
});

describe('routeCatch', () => {
  const originalEnv = process.env.NODE_ENV;
  const jsonSpy = vi.fn();

  beforeEach(() => {
    jsonSpy.mockReset();
    jsonSpy.mockImplementation((body, status) => ({
      _body: body,
      _status: status,
    }));
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
    vi.resetModules();
  });

  function makeCtx(requestId = 'req-abc') {
    return {
      get: (key: string) => (key === 'requestId' ? requestId : undefined),
      json: jsonSpy,
      req: { path: '/api/v1/foo', method: 'GET' },
    };
  }

  it('maps SQL duplicate key errors to a structured 409 envelope', async () => {
    process.env.NODE_ENV = 'production';
    const { routeCatch } = await import('../utils/safe-error');
    const err = { code: '23505', message: 'duplicate key value violates unique constraint "idx_foo"' };
    const ctx = makeCtx();
    routeCatch(ctx as any, err);
    expect(jsonSpy).toHaveBeenCalledWith(
      {
        success: false,
        error: {
          code: 'DUPLICATE_ENTRY',
          message: 'A record with these values already exists.',
          requestId: 'req-abc',
        },
      },
      409,
    );
  });

  it('falls through to safeInternalError with scrubbed message in prod', async () => {
    process.env.NODE_ENV = 'production';
    const { routeCatch } = await import('../utils/safe-error');
    const err = new Error('raw Postgres error with /etc/secrets path');
    const ctx = makeCtx();
    routeCatch(ctx as any, err, { code: 'MESSAGING_QUERY_FAILED', status: 503 });

    const [body, status] = jsonSpy.mock.calls[0];
    expect(status).toBe(503);
    expect(body.error.code).toBe('MESSAGING_QUERY_FAILED');
    expect(body.error.message).not.toContain('/etc/secrets');
    expect(body.error.requestId).toBe('req-abc');
  });

  it('preserves message in development so tests can assert on it', async () => {
    process.env.NODE_ENV = 'development';
    const { routeCatch } = await import('../utils/safe-error');
    const err = new Error('query failed: syntax error at or near "SELEECT"');
    const ctx = makeCtx();
    routeCatch(ctx as any, err);
    const [body] = jsonSpy.mock.calls[0];
    expect(body.error.message).toContain('SELEECT');
  });
});
