/**
 * Mwikila inbox + delegation routes — wiring smoke test.
 *
 * Confirms both routers mount and gate on auth (401 without a token).
 * Happy-path integration is covered by the e2e suite (live PG +
 * Supabase JWT) and the recorder/runtime unit tests.
 */

import { describe, it, expect } from 'vitest';

process.env.JWT_SECRET =
  process.env.JWT_SECRET ||
  'test-secret-jwt-0123456789abcdef0123456789abcdef';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.BORJIE_SKIP_DOTENV = 'true';

import { mwikilaInboxRouter } from '../mwikila-inbox.hono.js';
import { delegationRouter } from '../delegation.hono.js';

describe('Mr. Mwikila inbox router — wiring', () => {
  it('rejects unauth GET / with 401', async () => {
    const res = await mwikilaInboxRouter.request('/', { method: 'GET' });
    expect(res.status).toBe(401);
  });

  it('rejects unauth POST /:id/approve with 401', async () => {
    const res = await mwikilaInboxRouter.request(
      '/00000000-0000-0000-0000-000000000000/approve',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      },
    );
    expect(res.status).toBe(401);
  });

  it('rejects unauth POST /:id/deny with 401', async () => {
    const res = await mwikilaInboxRouter.request(
      '/00000000-0000-0000-0000-000000000000/deny',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      },
    );
    expect(res.status).toBe(401);
  });

  it('rejects unauth POST /:id/reverse with 401', async () => {
    const res = await mwikilaInboxRouter.request(
      '/00000000-0000-0000-0000-000000000000/reverse',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reversalToken: '00000000-0000-0000-0000-000000000000',
        }),
      },
    );
    expect(res.status).toBe(401);
  });
});

describe('Mr. Mwikila delegation router — wiring', () => {
  it('rejects unauth GET / with 401', async () => {
    const res = await delegationRouter.request('/', { method: 'GET' });
    expect(res.status).toBe(401);
  });

  it('rejects unauth PATCH / with 401', async () => {
    const res = await delegationRouter.request('/', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category: 'shifts', tier: 'T2' }),
    });
    expect(res.status).toBe(401);
  });
});
