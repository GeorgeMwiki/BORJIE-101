/**
 * Regression tests for CRITICAL-3 (audit
 * .audit/post-pr90-api-mcp-bug-sweep.md):
 *
 * M-Pesa webhook handlers must verify HMAC signature + timestamp BEFORE
 * any side effect. The middleware rejects forged callbacks with a 401
 * and never reaches the orchestrator.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { mpesaSignatureMiddleware } from '../middleware/mpesa-webhook.middleware';

const SECRET = 'test-mpesa-webhook-secret-123';

function makeReq(opts: {
  raw: string;
  signature?: string;
  timestamp?: number | string;
}): Request {
  const headers: Record<string, string> = {};
  if (opts.signature !== undefined) headers['x-mpesa-signature'] = opts.signature;
  if (opts.timestamp !== undefined) headers['x-mpesa-timestamp'] = String(opts.timestamp);
  return {
    headers,
    path: '/webhooks/mpesa/stk',
    rawBody: Buffer.from(opts.raw),
  } as unknown as Request;
}

function makeRes(): { res: Response; calls: Array<{ status: number; body: unknown }> } {
  const calls: Array<{ status: number; body: unknown }> = [];
  let pendingStatus = 200;
  const res = {
    status(code: number) {
      pendingStatus = code;
      return this;
    },
    json(body: unknown) {
      calls.push({ status: pendingStatus, body });
      return this;
    },
  } as unknown as Response;
  return { res, calls };
}

describe('mpesaSignatureMiddleware (CRITICAL-3)', () => {
  const noopLogger = { warn: () => undefined };
  let prevSecret: string | undefined;
  let prevRequired: string | undefined;
  let prevEnv: string | undefined;

  beforeEach(() => {
    prevSecret = process.env.MPESA_WEBHOOK_SECRET;
    prevRequired = process.env.MPESA_WEBHOOK_SECRET_REQUIRED;
    prevEnv = process.env.NODE_ENV;
    process.env.MPESA_WEBHOOK_SECRET = SECRET;
    process.env.NODE_ENV = 'test';
    delete process.env.MPESA_WEBHOOK_SECRET_REQUIRED;
  });

  afterEach(() => {
    if (prevSecret === undefined) delete process.env.MPESA_WEBHOOK_SECRET;
    else process.env.MPESA_WEBHOOK_SECRET = prevSecret;
    if (prevRequired === undefined) delete process.env.MPESA_WEBHOOK_SECRET_REQUIRED;
    else process.env.MPESA_WEBHOOK_SECRET_REQUIRED = prevRequired;
    if (prevEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevEnv;
  });

  it('accepts a request with a valid HMAC signature inside the replay window', () => {
    const mw = mpesaSignatureMiddleware(noopLogger);
    const raw = '{"Body":{"stkCallback":{"ResultCode":0}}}';
    const ts = Date.now();
    const sig = createHmac('sha256', SECRET).update(`${ts}.${raw}`).digest('hex');
    const req = makeReq({ raw, signature: sig, timestamp: ts });
    const { res, calls } = makeRes();
    let nextCalled = false;
    const next: NextFunction = () => {
      nextCalled = true;
    };
    mw(req, res, next);
    expect(nextCalled).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it('rejects a forged signature with 401', () => {
    const mw = mpesaSignatureMiddleware(noopLogger);
    const raw = '{"Body":{"stkCallback":{"ResultCode":0}}}';
    const ts = Date.now();
    const req = makeReq({
      raw,
      signature: 'a'.repeat(64),
      timestamp: ts,
    });
    const { res, calls } = makeRes();
    let nextCalled = false;
    mw(req, res, () => { nextCalled = true; });
    expect(nextCalled).toBe(false);
    expect(calls[0]?.status).toBe(401);
  });

  it('rejects a request missing the signature header', () => {
    const mw = mpesaSignatureMiddleware(noopLogger);
    const raw = '{"Body":{"stkCallback":{"ResultCode":0}}}';
    const req = makeReq({ raw, timestamp: Date.now() });
    const { res, calls } = makeRes();
    let nextCalled = false;
    mw(req, res, () => { nextCalled = true; });
    expect(nextCalled).toBe(false);
    expect(calls[0]?.status).toBe(401);
  });

  it('rejects a stale timestamp (> 5 minutes drift)', () => {
    const mw = mpesaSignatureMiddleware(noopLogger);
    const raw = '{"Body":{"stkCallback":{"ResultCode":0}}}';
    const ts = Date.now() - 10 * 60 * 1000;
    const sig = createHmac('sha256', SECRET).update(`${ts}.${raw}`).digest('hex');
    const req = makeReq({ raw, signature: sig, timestamp: ts });
    const { res, calls } = makeRes();
    let nextCalled = false;
    mw(req, res, () => { nextCalled = true; });
    expect(nextCalled).toBe(false);
    expect(calls[0]?.status).toBe(401);
  });

  it('passes through when secret unset and not required (dev mode)', () => {
    delete process.env.MPESA_WEBHOOK_SECRET;
    process.env.NODE_ENV = 'development';
    const mw = mpesaSignatureMiddleware(noopLogger);
    const req = makeReq({ raw: '{}' });
    const { res, calls } = makeRes();
    let nextCalled = false;
    mw(req, res, () => { nextCalled = true; });
    expect(nextCalled).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it('throws at construction time in production when secret is unset', () => {
    delete process.env.MPESA_WEBHOOK_SECRET;
    process.env.NODE_ENV = 'production';
    expect(() => mpesaSignatureMiddleware(noopLogger)).toThrow(
      /MPESA_WEBHOOK_SECRET must be set/
    );
  });
});
