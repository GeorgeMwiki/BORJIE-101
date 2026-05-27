/**
 * Pilot kill-switch middleware tests.
 *
 * Covers:
 *   1. pilot disabled (default)              → 503 PILOT_PAUSED
 *   2. PILOT_ENABLED=true in env             → handler runs, 200
 *   3. PILOT_KILL_SWITCH_OPEN=true wins      → 503 even when PILOT_ENABLED
 *   4. no tenantId on auth context           → pass-through (auth handles it)
 */

import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { pilotKillSwitch } from '../pilot-kill-switch.js';

function withAuth(tenantId: string | null) {
  return async (c: any, next: any) => {
    if (tenantId !== null) {
      c.set('auth', { tenantId, userId: 'u1' });
    }
    await next();
  };
}

describe('pilotKillSwitch — default-off (accidental-deploy guard)', () => {
  it('returns 503 PILOT_PAUSED when no env signals are present', async () => {
    const app = new Hono();
    app.use('*', withAuth('t1'));
    app.use('*', pilotKillSwitch({ env: {} }));
    app.get('/pilot-only', (c) => c.text('ok'));

    const res = await app.request('/pilot-only');
    expect(res.status).toBe(503);
    const body = (await res.json()) as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('PILOT_PAUSED');
  });
});

describe('pilotKillSwitch — env opt-in lets the route run', () => {
  it('passes through when PILOT_ENABLED=true and no kill-switch flag', async () => {
    const app = new Hono();
    app.use('*', withAuth('t1'));
    app.use('*', pilotKillSwitch({ env: { PILOT_ENABLED: 'true' } }));
    app.get('/pilot-only', (c) => c.text('ok'));

    const res = await app.request('/pilot-only');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('ok');
  });
});

describe('pilotKillSwitch — emergency kill-switch wins', () => {
  it('returns 503 even when PILOT_ENABLED=true once kill-switch is opened', async () => {
    const app = new Hono();
    app.use('*', withAuth('t1'));
    app.use(
      '*',
      pilotKillSwitch({
        env: {
          PILOT_ENABLED: 'true',
          PILOT_KILL_SWITCH_OPEN: 'true',
        },
      }),
    );
    app.get('/pilot-only', (c) => c.text('ok'));

    const res = await app.request('/pilot-only');
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('PILOT_PAUSED');
  });
});

describe('pilotKillSwitch — no tenant → pass-through', () => {
  it('does not 503 when no auth is bound (auth middleware will reject)', async () => {
    const app = new Hono();
    app.use('*', withAuth(null));
    app.use('*', pilotKillSwitch({ env: {} }));
    app.get('/pilot-only', (c) => c.text('ok'));

    const res = await app.request('/pilot-only');
    // No 503 from the kill-switch — the handler ran. (The real auth
    // middleware would have rejected with 401 before this point.)
    expect(res.status).toBe(200);
  });
});
