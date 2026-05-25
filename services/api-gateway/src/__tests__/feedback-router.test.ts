/**
 * Feedback router schema tests (Wave-K wire-up).
 *
 * Pins the POST `/api/v1/feedback` contract after the union widening:
 *
 *   - legacy `{type, subject, message, rating?}` shape (back-compat)
 *   - new turn shape `{turnId, threadId, signal, correctionText}`
 *   - malformed shape rejected as 400
 *
 * The router shares the same `feedback_submissions` table for both
 * shapes — the turn shape is stored with `type: 'turn-thumbs'` and the
 * raw signal payload preserved in `context`, so analytics can fan it
 * out without a schema migration today.
 */

import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import jwt from 'jsonwebtoken';
import { feedbackRouter } from '../routes/feedback';
import { getJwtSecret } from '../config/jwt';

function mintJwt(): string {
  return jwt.sign(
    {
      userId: 'usr_test',
      tenantId: 'tn_test',
      role: 'TENANT_ADMIN',
      permissions: ['*'],
      propertyAccess: ['*'],
    },
    getJwtSecret(),
    { algorithm: 'HS256', expiresIn: '2h' },
  );
}

interface InsertCapture {
  readonly values: unknown;
}

function buildApp(captures: InsertCapture[]) {
  const app = new Hono();
  const stubChain = {
    values: async (v: unknown) => {
      captures.push({ values: v });
    },
  };
  const db = {
    insert: vi.fn(() => stubChain),
  };
  app.use('*', async (c, next) => {
    c.set('services', { db } as never);
    await next();
  });
  app.route('/feedback', feedbackRouter);
  return { app, db };
}

describe('feedback router POST /', () => {
  it('accepts the legacy {type, subject, message, rating?} shape (back-compat)', async () => {
    const captures: InsertCapture[] = [];
    const { app } = buildApp(captures);
    const res = await app.request('/feedback', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${mintJwt()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type: 'bug',
        subject: 'Login button is grey on Android',
        message: 'Same on Chrome and Firefox.',
        rating: 3,
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      success: boolean;
      data: { id: string; status: string };
    };
    expect(body.success).toBe(true);
    expect(body.data.status).toBe('submitted');
    expect(captures).toHaveLength(1);
    const values = captures[0]!.values as Record<string, unknown>;
    expect(values.type).toBe('bug');
    expect(values.subject).toBe('Login button is grey on Android');
    expect(values.rating).toBe(3);
  });

  it('accepts the new turn shape {turnId, threadId, signal, correctionText}', async () => {
    const captures: InsertCapture[] = [];
    const { app } = buildApp(captures);
    const res = await app.request('/feedback', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${mintJwt()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        turnId: 'turn_abc',
        threadId: 'thread_xyz',
        signal: 'thumbs-down',
        correctionText: 'Incorrect citation — lease clause 4.2 not 4.3.',
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      success: boolean;
      data: { id: string; status: string; turnId: string; signal: string; accepted: boolean };
    };
    expect(body.success).toBe(true);
    expect(body.data.turnId).toBe('turn_abc');
    expect(body.data.signal).toBe('down');
    expect(body.data.accepted).toBe(true);
    expect(captures).toHaveLength(1);
    const values = captures[0]!.values as Record<string, unknown>;
    expect(values.type).toBe('turn-thumbs');
    expect(values.rating).toBe(1); // thumbs-down maps to rating 1
    const ctx = values.context as Record<string, unknown>;
    expect(ctx.turnId).toBe('turn_abc');
    expect(ctx.threadId).toBe('thread_xyz');
    expect(ctx.signal).toBe('down');
    expect(ctx.correctionText).toBe('Incorrect citation — lease clause 4.2 not 4.3.');
  });

  it('accepts a thumbs-up turn shape with null threadId + null correctionText', async () => {
    const captures: InsertCapture[] = [];
    const { app } = buildApp(captures);
    const res = await app.request('/feedback', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${mintJwt()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        turnId: 'turn_ok',
        threadId: null,
        signal: 'up',
        correctionText: null,
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      success: boolean;
      data: { signal: string };
    };
    expect(body.data.signal).toBe('up');
    const values = captures[0]!.values as Record<string, unknown>;
    expect(values.rating).toBe(5);
    const ctx = values.context as Record<string, unknown>;
    expect(ctx.threadId).toBeNull();
  });

  it('rejects a malformed shape (missing required fields for both branches)', async () => {
    const captures: InsertCapture[] = [];
    const { app } = buildApp(captures);
    const res = await app.request('/feedback', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${mintJwt()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        // No `type`, no `turnId` — matches neither branch of the union.
        subject: 'orphan',
      }),
    });
    expect(res.status).toBe(400);
    expect(captures).toHaveLength(0);
  });
});
