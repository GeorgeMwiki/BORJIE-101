/**
 * Canonical error-response helper — deep-audit 2026-05-20 (HIGH) +
 * DA1/DA4 follow-up 2026-05-21.
 *
 * Two regression suites:
 *
 *   1. Shape invariants — every helper emits the canonical envelope:
 *      { success: false, error: { code, message, details? }, meta: { requestId?, timestamp } }
 *
 *   2. `redactDetails` — the auto-applied scrubber strips Error stacks,
 *      drops secret-shaped keys, clamps depth, clamps string length,
 *      caps total size, and handles circular references.
 *
 * DA4: the previous revision mocked `c.json` and asserted on the mock —
 * which let the helper drift in ways Hono itself would surface (status
 * code, Content-Type, JSON serialization). These tests use real Hono
 * apps and assert on the real `Response`.
 */

import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import {
  errorResponse,
  redactDetails,
  e400,
  e401,
  e403,
  e404,
  e409,
  e422,
  e429,
  e500,
  e502,
  e503,
  e504,
} from '../utils/error-response';

// ---------------------------------------------------------------------------
// Helpers — boot a one-shot Hono app per assertion and round-trip the
// response so we exercise the actual Hono `c.json` path, status code, and
// Content-Type negotiation.
// ---------------------------------------------------------------------------

interface CanonicalBody {
  readonly success: false;
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly details?: Record<string, unknown>;
  };
  readonly meta: {
    readonly requestId?: string;
    readonly timestamp: string;
  };
}

async function runHandler(
  handler: (c: Parameters<Parameters<Hono['get']>[1]>[0]) => Response,
  opts?: { requestId?: string },
): Promise<{ status: number; contentType: string | null; body: CanonicalBody }> {
  const app = new Hono();
  app.use('*', async (c, next) => {
    if (opts?.requestId) c.set('requestId', opts.requestId);
    await next();
  });
  app.get('/test', handler);
  const res = await app.request('/test');
  const contentType = res.headers.get('content-type');
  const body = (await res.json()) as CanonicalBody;
  return { status: res.status, contentType, body };
}

const ISO_8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

// ---------------------------------------------------------------------------
// errorResponse — canonical shape & meta
// ---------------------------------------------------------------------------

describe('errorResponse — canonical shape via real Hono', () => {
  it('emits { success:false, error:{code,message}, meta:{requestId,timestamp} }', async () => {
    const { status, contentType, body } = await runHandler(
      (c) => errorResponse(c, 400, 'BAD_INPUT', 'Bad input'),
      { requestId: 'req-123' },
    );

    expect(status).toBe(400);
    expect(contentType).toMatch(/application\/json/);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('BAD_INPUT');
    expect(body.error.message).toBe('Bad input');
    expect(body.meta.requestId).toBe('req-123');
    expect(body.meta.timestamp).toMatch(ISO_8601);
  });

  it('includes details when provided (and they are safe)', async () => {
    const { body } = await runHandler((c) =>
      errorResponse(c, 422, 'VALIDATION_ERROR', 'Invalid payload', {
        field: 'email',
        reason: 'format',
      }),
    );
    expect(body.error.details).toEqual({ field: 'email', reason: 'format' });
  });

  it('omits details when not provided (no accidental undefined leak)', async () => {
    const { body } = await runHandler((c) =>
      errorResponse(c, 400, 'BAD_INPUT', 'Bad input'),
    );
    expect('details' in body.error).toBe(false);
  });

  it('omits requestId from meta when context has none', async () => {
    const { body } = await runHandler((c) =>
      errorResponse(c, 500, 'BOOM', 'oops'),
    );
    expect('requestId' in body.meta).toBe(false);
    expect(body.meta.timestamp).toMatch(ISO_8601);
  });

  it('falls back to x-request-id when requestId is not set', async () => {
    const app = new Hono();
    app.use('*', async (c, next) => {
      c.set('x-request-id', 'fallback-id');
      await next();
    });
    app.get('/test', (c) => errorResponse(c, 400, 'X', 'm'));
    const res = await app.request('/test');
    const body = (await res.json()) as CanonicalBody;
    expect(body.meta.requestId).toBe('fallback-id');
  });
});

// ---------------------------------------------------------------------------
// Status-code sugar helpers
// ---------------------------------------------------------------------------

describe('status-code sugar helpers — real Hono round-trip', () => {
  it('e400 emits status 400 with caller-supplied code', async () => {
    const { status, body } = await runHandler((c) =>
      e400(c, 'BAD_INPUT', 'invalid'),
    );
    expect(status).toBe(400);
    expect(body.error.code).toBe('BAD_INPUT');
    expect(body.error.message).toBe('invalid');
  });

  it('e401 defaults to UNAUTHENTICATED / Authentication required', async () => {
    const { status, body } = await runHandler((c) => e401(c));
    expect(status).toBe(401);
    expect(body.error.code).toBe('UNAUTHENTICATED');
    expect(body.error.message).toBe('Authentication required');
  });

  it('e403 defaults to FORBIDDEN / Insufficient permissions', async () => {
    const { status, body } = await runHandler((c) => e403(c));
    expect(status).toBe(403);
    expect(body.error.code).toBe('FORBIDDEN');
    expect(body.error.message).toBe('Insufficient permissions');
  });

  it('e404 defaults to NOT_FOUND / Resource not found', async () => {
    const { status, body } = await runHandler((c) => e404(c));
    expect(status).toBe(404);
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.message).toBe('Resource not found');
  });

  it('e409 accepts code+message+details', async () => {
    const { status, body } = await runHandler((c) =>
      e409(c, 'DUPLICATE_EMAIL', 'Email taken', { email: 'a@b.c' }),
    );
    expect(status).toBe(409);
    expect(body.error.code).toBe('DUPLICATE_EMAIL');
    expect(body.error.details).toEqual({ email: 'a@b.c' });
  });

  it('e422 defaults to VALIDATION_ERROR', async () => {
    const { status, body } = await runHandler((c) =>
      e422(c, undefined, 'bad'),
    );
    expect(status).toBe(422);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toBe('bad');
  });

  it('e429 defaults to RATE_LIMITED / Too many requests', async () => {
    const { status, body } = await runHandler((c) => e429(c));
    expect(status).toBe(429);
    expect(body.error.code).toBe('RATE_LIMITED');
    expect(body.error.message).toBe('Too many requests');
  });

  it('e500 defaults to INTERNAL_ERROR / Internal server error', async () => {
    const { status, body } = await runHandler((c) => e500(c));
    expect(status).toBe(500);
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(body.error.message).toBe('Internal server error');
  });

  it('e502 defaults to BAD_GATEWAY', async () => {
    const { status, body } = await runHandler((c) => e502(c));
    expect(status).toBe(502);
    expect(body.error.code).toBe('BAD_GATEWAY');
    expect(body.error.message).toMatch(/upstream/i);
  });

  it('e503 requires explicit code+message', async () => {
    const { status, body } = await runHandler((c) =>
      e503(c, 'UPSTREAM_DOWN', 'GePG offline'),
    );
    expect(status).toBe(503);
    expect(body.error.code).toBe('UPSTREAM_DOWN');
    expect(body.error.message).toBe('GePG offline');
  });

  it('e504 defaults to GATEWAY_TIMEOUT', async () => {
    const { status, body } = await runHandler((c) => e504(c));
    expect(status).toBe(504);
    expect(body.error.code).toBe('GATEWAY_TIMEOUT');
    expect(body.error.message).toMatch(/timed out/i);
  });
});

// ---------------------------------------------------------------------------
// Shape invariants — every helper, every time.
// ---------------------------------------------------------------------------

describe('shape invariants across all helpers', () => {
  const helpers: Array<[string, number, (c: never) => Response]> = [
    ['e400', 400, (c) => e400(c, 'X', 'm')],
    ['e401', 401, (c) => e401(c)],
    ['e403', 403, (c) => e403(c)],
    ['e404', 404, (c) => e404(c)],
    ['e409', 409, (c) => e409(c, 'X', 'm')],
    ['e422', 422, (c) => e422(c)],
    ['e429', 429, (c) => e429(c)],
    ['e500', 500, (c) => e500(c)],
    ['e502', 502, (c) => e502(c)],
    ['e503', 503, (c) => e503(c, 'X', 'm')],
    ['e504', 504, (c) => e504(c)],
  ];

  for (const [name, expectedStatus, call] of helpers) {
    it(`${name} emits status ${expectedStatus} with success:false + error.code + error.message + meta.timestamp + application/json`, async () => {
      const { status, contentType, body } = await runHandler(
        (c) => call(c as never),
        { requestId: 'req-abc' },
      );
      expect(status).toBe(expectedStatus);
      expect(contentType).toMatch(/application\/json/);
      expect(body.success).toBe(false);
      expect(typeof body.error.code).toBe('string');
      expect(body.error.code.length).toBeGreaterThan(0);
      expect(typeof body.error.message).toBe('string');
      expect(body.error.message.length).toBeGreaterThan(0);
      expect(body.meta.timestamp).toMatch(ISO_8601);
      expect(body.meta.requestId).toBe('req-abc');
    });
  }
});

// ---------------------------------------------------------------------------
// redactDetails — DA1 leak-primitive hardening
// ---------------------------------------------------------------------------

describe('redactDetails — secret/PII scrubber', () => {
  it('returns undefined for undefined input (so the key gets omitted)', () => {
    expect(redactDetails(undefined)).toBeUndefined();
  });

  it('returns undefined for null input', () => {
    // null arrives via JS callers that haven't typed properly — treat as
    // "no details" rather than emitting `"details": null`.
    expect(
      redactDetails(null as unknown as Record<string, unknown> | undefined),
    ).toBeUndefined();
  });

  it('passes safe primitives unchanged', () => {
    const out = redactDetails({
      field: 'email',
      count: 3,
      flag: true,
      empty: null,
    });
    expect(out).toEqual({
      field: 'email',
      count: 3,
      flag: true,
      empty: null,
    });
  });

  describe('Error flattening', () => {
    it('strips Error instances to { name, message } only — no stack, no cause', () => {
      const err = new Error('boom');
      err.stack = 'Error: boom\n    at /secret/internal/path:42';
      // Synthesize a cause chain — should not be exposed.
      (err as Error & { cause?: unknown }).cause = {
        upstream: 'sk_live_TOPSECRET',
      };

      const out = redactDetails({ err });
      expect(out?.err).toEqual({ name: 'Error', message: 'boom' });
      // No stack, no cause, no extras.
      expect(JSON.stringify(out)).not.toContain('secret');
      expect(JSON.stringify(out)).not.toContain('stack');
      expect(JSON.stringify(out)).not.toContain('cause');
    });

    it('flattens nested Error instances inside arrays', () => {
      const out = redactDetails({
        errors: [new TypeError('one'), new RangeError('two')],
      });
      expect(out?.errors).toEqual([
        { name: 'TypeError', message: 'one' },
        { name: 'RangeError', message: 'two' },
      ]);
    });

    it('clamps Error message strings to 500 chars', () => {
      const longMsg = 'x'.repeat(800);
      const out = redactDetails({ err: new Error(longMsg) });
      const errOut = out?.err as { message: string };
      expect(errOut.message.length).toBeLessThanOrEqual(501); // 500 + ellipsis
      expect(errOut.message.endsWith('…')).toBe(true);
    });
  });

  describe('secret-key redaction', () => {
    it('redacts keys matching /password|secret|token|key|cookie|auth|credential/i', () => {
      const out = redactDetails({
        userId: 'u-1',
        password: 'hunter2',
        SECRET: 'shh',
        apiToken: 'tok_xyz',
        sessionCookie: 'abc=def',
        authHeader: 'Bearer xxx',
        my_credentials: { user: 'a', pass: 'b' },
        publicKey: '-----BEGIN-----',
      });
      expect(out?.userId).toBe('u-1');
      expect(out?.password).toBe('[redacted]');
      expect(out?.SECRET).toBe('[redacted]');
      expect(out?.apiToken).toBe('[redacted]');
      expect(out?.sessionCookie).toBe('[redacted]');
      expect(out?.authHeader).toBe('[redacted]');
      expect(out?.my_credentials).toBe('[redacted]');
      expect(out?.publicKey).toBe('[redacted]');
    });

    it('redacts secret-shaped keys even when nested', () => {
      const out = redactDetails({
        user: {
          name: 'Ada',
          password: 'hunter2',
          tokens: { refresh: 'r-1', access: 'a-1' },
        },
      });
      const user = out?.user as Record<string, unknown>;
      expect(user.name).toBe('Ada');
      expect(user.password).toBe('[redacted]');
      expect(user.tokens).toBe('[redacted]');
    });
  });

  describe('depth cap', () => {
    it('caps object depth at 3 — deeper sub-objects become [depth-capped]', () => {
      // Top-level object is depth 0. Recursing into `.a` is depth 1,
      // into `.b` is depth 2, into `.c` is depth 3 — at depth >= 3 we
      // stop descending and return the sentinel. So `b.c` (the value
      // we'd otherwise expand) becomes the string sentinel.
      const out = redactDetails({
        a: { b: { c: { d: { e: 'too deep' } } } },
      });
      const a = out?.a as Record<string, unknown>;
      const b = a.b as Record<string, unknown>;
      expect(b.c).toBe('[depth-capped]');
    });

    it('preserves shallow trees within the depth cap', () => {
      const out = redactDetails({ a: { b: 'ok' } });
      const a = out?.a as Record<string, unknown>;
      expect(a.b).toBe('ok');
    });
  });

  describe('string length cap', () => {
    it('clamps each string value at 500 chars with an ellipsis', () => {
      const long = 'a'.repeat(1200);
      const out = redactDetails({ note: long });
      const note = out?.note as string;
      expect(note.length).toBeLessThanOrEqual(501);
      expect(note.endsWith('…')).toBe(true);
      expect(note.startsWith('a')).toBe(true);
    });

    it('does not clamp strings under the cap', () => {
      const out = redactDetails({ note: 'short' });
      expect(out?.note).toBe('short');
    });
  });

  describe('total size cap', () => {
    it('replaces the whole details object with { _redacted: "details too large" } when serialized > 8KB', () => {
      // Build a large but plausible payload — many small fields whose
      // total serialized size blows past 8 KB. Each field is below the
      // 500-char per-string cap, so the only protection left is the
      // total-size guard.
      const big: Record<string, string> = {};
      for (let i = 0; i < 200; i++) {
        big[`field_${i}`] = 'x'.repeat(100);
      }
      const out = redactDetails(big);
      expect(out).toEqual({ _redacted: 'details too large' });
    });

    it('preserves details that fit within the size cap', () => {
      const out = redactDetails({ a: 'one', b: 'two' });
      expect(out).toEqual({ a: 'one', b: 'two' });
    });
  });

  describe('circular reference handling', () => {
    it('replaces back-edges with "[circular]" without throwing', () => {
      // Self-referential object: a.self -> a. The cycle closes at depth 2,
      // which is still within the depth cap (so we exercise the cycle
      // detector, not the depth guard).
      const a: Record<string, unknown> = { name: 'a' };
      a.self = a;

      const out = redactDetails({ root: a });
      expect(() => JSON.stringify(out)).not.toThrow();
      // The back-edge should be replaced with the sentinel string.
      expect(JSON.stringify(out)).toContain('[circular]');
    });

    it('does not flag legit shared sibling references as circular', () => {
      const shared = { id: 'shared' };
      const out = redactDetails({ left: shared, right: shared });
      expect(out?.left).toEqual({ id: 'shared' });
      expect(out?.right).toEqual({ id: 'shared' });
      expect(JSON.stringify(out)).not.toContain('[circular]');
    });
  });

  describe('unserializable types', () => {
    it('drops functions and symbols defensively', () => {
      const out = redactDetails({
        fn: () => 1,
        sym: Symbol('x'),
        ok: 'ok',
      });
      expect(out?.fn).toBe('[unserializable]');
      expect(out?.sym).toBe('[unserializable]');
      expect(out?.ok).toBe('ok');
    });

    it('renders Date instances as ISO strings', () => {
      const d = new Date('2026-05-21T10:00:00.000Z');
      const out = redactDetails({ when: d });
      expect(out?.when).toBe('2026-05-21T10:00:00.000Z');
    });
  });
});

// ---------------------------------------------------------------------------
// redactDetails wired through errorResponse — the end-to-end protection.
// ---------------------------------------------------------------------------

describe('errorResponse applies redactDetails before sending', () => {
  it('flattens Error inside details when called via e400', async () => {
    const err = new Error('inner explosion');
    err.stack = 'Error: inner explosion\n    at /opt/app/secrets.ts:99';
    const { body } = await runHandler((c) =>
      e400(c, 'BOOM', 'kaboom', { err }),
    );
    expect(body.error.details?.err).toEqual({
      name: 'Error',
      message: 'inner explosion',
    });
    expect(JSON.stringify(body)).not.toContain('secrets.ts');
  });

  it('redacts secret-shaped keys when called via e422', async () => {
    const { body } = await runHandler((c) =>
      e422(c, 'VAL', 'bad', {
        userId: 'u-1',
        password: 'hunter2',
        accessToken: 'tok',
      }),
    );
    expect(body.error.details?.userId).toBe('u-1');
    expect(body.error.details?.password).toBe('[redacted]');
    expect(body.error.details?.accessToken).toBe('[redacted]');
  });

  it('clamps long detail strings before they cross the wire', async () => {
    const long = 'x'.repeat(2000);
    const { body } = await runHandler((c) =>
      e409(c, 'DUP', 'duplicate', { note: long }),
    );
    const note = body.error.details?.note as string;
    expect(note.length).toBeLessThanOrEqual(501);
    expect(note.endsWith('…')).toBe(true);
  });

  it('replaces oversized payloads with _redacted sentinel', async () => {
    const big: Record<string, string> = {};
    for (let i = 0; i < 200; i++) {
      big[`field_${i}`] = 'x'.repeat(100);
    }
    const { body } = await runHandler((c) =>
      e409(c, 'BIG', 'too big', big),
    );
    expect(body.error.details).toEqual({ _redacted: 'details too large' });
  });
});
