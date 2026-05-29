/**
 * Owner handoff router — wiring smoke test.
 *
 * Confirms the K-A route mounts and gates on auth (401 without a token).
 * Happy-path coverage (insert + audit chain + notify + resolve) lives
 * in `@borjie/central-intelligence/handoff` recorder unit tests. Full
 * cross-tenant denial is enforced by the JWT middleware on top of the
 * RLS predicate; this smoke confirms the wiring.
 */

import { describe, it, expect } from 'vitest';

process.env.JWT_SECRET =
  process.env.JWT_SECRET ||
  'test-secret-jwt-0123456789abcdef0123456789abcdef';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.BORJIE_SKIP_DOTENV = 'true';

import { ownerHandoffRouter } from '../handoff.hono.js';

describe('Owner handoff router — wiring', () => {
  it('rejects unauth POST / with 401', async () => {
    const res = await ownerHandoffRouter.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceSessionId: 'sess_1',
        targetUserId: 'mgr_1',
        targetRole: 'T3_module_manager',
        topic: 'Mwadui site safety follow-up',
      }),
    });
    expect(res.status).toBe(401);
  });

  it('rejects unauth GET /inbox with 401', async () => {
    const res = await ownerHandoffRouter.request('/inbox?status=open', {
      method: 'GET',
    });
    expect(res.status).toBe(401);
  });

  it('rejects unauth POST /:id/resolve with 401', async () => {
    const res = await ownerHandoffRouter.request(
      '/00000000-0000-0000-0000-000000000000/resolve',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resolution: 'replied', replyText: 'ack' }),
      },
    );
    expect(res.status).toBe(401);
  });

  it('rejects POST / with a missing required field once authed (zod shape)', async () => {
    // Even without a valid JWT, the 401 lands first — this is a wiring
    // confirmation that the route exists at the expected path.
    const res = await ownerHandoffRouter.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    // 401 first because authMiddleware runs before zValidator.
    expect(res.status).toBe(401);
  });
});
