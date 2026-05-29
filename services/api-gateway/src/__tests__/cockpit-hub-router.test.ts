/**
 * Tests for the owner cockpit-hub aggregator endpoint (Roadmap R7).
 *
 * Drives the router against an in-memory db.execute stub so the five
 * panels are exercised deterministically. Asserts:
 *   - 401 without bearer token
 *   - empty response shape when db is null
 *   - decisions + reminders flow through from the stub
 *   - brief headline reflects pending-decision count
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';

process.env.JWT_SECRET =
  process.env.JWT_SECRET ??
  'test-secret-jwt-0123456789abcdef0123456789abcdef';
process.env.NODE_ENV = process.env.NODE_ENV ?? 'test';
process.env.BORJIE_SKIP_DOTENV = 'true';

import { generateToken } from '../middleware/auth';
import { UserRole } from '../types/user-role';
import { cockpitHubRouter } from '../routes/owner/cockpit-hub.hono';

function bearer(): string {
  return `Bearer ${generateToken({
    userId: 'usr-test',
    tenantId: 'tnt-test',
    role: UserRole.ADMIN as never,
    permissions: ['*'],
    propertyAccess: ['*'],
  })}`;
}

function buildDb(plan: {
  readonly decisions: ReadonlyArray<Record<string, unknown>>;
  readonly reminders: ReadonlyArray<Record<string, unknown>>;
}): {
  execute: (q: unknown) => Promise<unknown>;
} {
  // Pattern-match on the rendered SQL string so the test is order-
  // independent — Promise.all calls selectDecisions and selectReminders
  // concurrently, and the microtask order varies between Node releases.
  return {
    execute: async (q: unknown) => {
      const sqlText =
        typeof q === 'object' && q !== null && 'queryChunks' in q
          ? JSON.stringify((q as { queryChunks: unknown }).queryChunks)
          : JSON.stringify(q);
      if (sqlText.includes('decisions')) return plan.decisions;
      if (sqlText.includes('reminders')) return plan.reminders;
      return [];
    },
  };
}

function attach(db: { execute: (q: unknown) => Promise<unknown> } | null) {
  return async (
    c: { set: (k: string, v: unknown) => void },
    next: () => Promise<void>,
  ) => {
    c.set('db', db);
    await next();
  };
}

function mount(db: { execute: (q: unknown) => Promise<unknown> } | null) {
  const app = new Hono();
  app.use('*', attach(db));
  app.route('/owner/cockpit', cockpitHubRouter);
  return app;
}

beforeAll(() => {
  expect(process.env.JWT_SECRET?.length ?? 0).toBeGreaterThanOrEqual(32);
});

describe('GET /api/v1/owner/cockpit/hub', () => {
  it('rejects without bearer token (401)', async () => {
    const app = mount(null);
    const res = await app.request('/owner/cockpit/hub');
    expect(res.status).toBe(401);
  });

  it('returns 503 envelope when db is null', async () => {
    const app = mount(null);
    const res = await app.request('/owner/cockpit/hub', {
      headers: { Authorization: bearer() },
    });
    expect(res.status).toBe(503);
    const body = (await res.json()) as { success: boolean };
    expect(body.success).toBe(false);
  });

  it('returns empty arrays + idle brief when db tables are empty', async () => {
    const db = buildDb({ decisions: [], reminders: [] });
    const app = mount(db);
    const res = await app.request('/owner/cockpit/hub', {
      headers: { Authorization: bearer() },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      brief: { headlineEn: string; headlineSw: string };
      decisions: unknown[];
      reminders: unknown[];
      opportunities: unknown[];
      risks: unknown[];
    };
    expect(body.brief.headlineEn).toBe('No fresh brief yet');
    expect(body.brief.headlineSw).toBe('Hakuna muhtasari mpya bado');
    expect(body.decisions).toEqual([]);
    expect(body.reminders).toEqual([]);
    expect(body.opportunities).toEqual([]);
    expect(body.risks).toEqual([]);
  });

  it('hydrates decisions + reminders from db rows', async () => {
    const decisionsRows = [
      {
        id: 'dec_001',
        summary: 'Approve T1 royalty payout',
        severity: 'high',
        raised_at: '2026-05-29T10:00:00.000Z',
      },
      {
        id: 'dec_002',
        summary: 'Confirm Geita pit 2 shift change',
        severity: 'medium',
        raised_at: '2026-05-29T09:00:00.000Z',
      },
    ];
    const remindersRows = [
      {
        id: 'rem_001',
        text: 'Sign monthly TRA filing',
        due_at: '2026-05-30T08:00:00.000Z',
      },
    ];
    const db = buildDb({
      decisions: decisionsRows,
      reminders: remindersRows,
    });
    const app = mount(db);
    const res = await app.request('/owner/cockpit/hub', {
      headers: { Authorization: bearer() },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      brief: { headlineEn: string; headlineSw: string };
      decisions: { id: string; severity: string }[];
      reminders: { id: string; text: string }[];
    };
    expect(body.decisions).toHaveLength(2);
    expect(body.decisions[0].id).toBe('dec_001');
    expect(body.decisions[0].severity).toBe('high');
    expect(body.reminders).toHaveLength(1);
    expect(body.reminders[0].text).toBe('Sign monthly TRA filing');
    expect(body.brief.headlineEn).toMatch(/2 pending decision/);
    expect(body.brief.headlineSw).toMatch(/Maamuzi 2 yanasubiri/);
  });
});
