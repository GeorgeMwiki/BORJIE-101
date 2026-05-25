/**
 * Kill-switch middleware unit tests.
 *
 * Covers the three load-bearing branches:
 *   1. flag OFF        → handler runs, 200, no audit
 *   2. flag ON         → 503 KILL_SWITCH_ACTIVE, audit emitted
 *   3. service missing → pass-through (degraded boot)
 *
 * Also covers the supporting safety nets:
 *   - flag lookup throws + prod → 503 KILL_SWITCH_LOOKUP_FAILED (DA1 fail-closed)
 *   - flag lookup throws + dev  → pass-through + WARN
 *   - missing tenantId          → pass-through (auth middleware's job)
 *   - audit emitter throws      → still serves 503 (kill-switch is load-bearing)
 *   - bad operation name        → constructor throws
 */

import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import {
  killSwitchGuard,
  KILL_SWITCH_FLAG_KEYS,
  ALL_KILL_SWITCH_FLAG_KEYS,
  type KillSwitchAuditEvent,
  type KillSwitchFeatureFlagsLike,
} from '../kill-switch.middleware';

function withAuth(tenantId: string | null, userId: string = 'u1') {
  return async (c: any, next: any) => {
    if (tenantId !== null) {
      c.set('auth', { tenantId, userId });
    }
    await next();
  };
}

function makeFlags(enabledMap: Record<string, boolean>): KillSwitchFeatureFlagsLike {
  return {
    async isEnabled(_tenantId: string, key: string) {
      return Boolean(enabledMap[key]);
    },
  };
}

function withServices(flags: KillSwitchFeatureFlagsLike | null) {
  return async (c: any, next: any) => {
    c.set('services', { featureFlags: flags });
    await next();
  };
}

describe('killSwitchGuard — flag OFF', () => {
  it('passes through and runs the handler when flag is FALSE', async () => {
    const app = new Hono();
    const flags = makeFlags({ [KILL_SWITCH_FLAG_KEYS['eviction']]: false });
    const audit = vi.fn();

    app.use('*', withAuth('t1'));
    app.use('*', withServices(flags));
    app.post(
      '/terminate',
      killSwitchGuard('eviction', { emitAudit: audit }),
      (c) => c.json({ ok: true }),
    );

    const res = await app.request('/terminate', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
    expect(audit).not.toHaveBeenCalled();
  });

  it('passes through when the flag service returns FALSE for an unknown flag', async () => {
    // The service contract is that unknown flags resolve to FALSE.
    const app = new Hono();
    const flags = makeFlags({}); // empty map → everything resolves to false
    const audit = vi.fn();

    app.use('*', withAuth('t1'));
    app.use('*', withServices(flags));
    app.post(
      '/refund',
      killSwitchGuard('payment-reversal', { emitAudit: audit }),
      (c) => c.json({ ok: true }),
    );

    const res = await app.request('/refund', { method: 'POST' });
    expect(res.status).toBe(200);
    expect(audit).not.toHaveBeenCalled();
  });
});

describe('killSwitchGuard — flag ON', () => {
  it('short-circuits with 503 KILL_SWITCH_ACTIVE when flag is TRUE', async () => {
    const app = new Hono();
    const flags = makeFlags({
      [KILL_SWITCH_FLAG_KEYS['account-deletion']]: true,
    });
    const audit = vi.fn();

    app.use('*', withAuth('t1', 'alice'));
    app.use('*', withServices(flags));
    app.post(
      '/delete-request/abc/execute',
      killSwitchGuard('account-deletion', { emitAudit: audit }),
      (c) => c.json({ ok: true }),
    );

    const res = await app.request('/delete-request/abc/execute', {
      method: 'POST',
    });
    expect(res.status).toBe(503);
    const body = (await res.json()) as {
      success: boolean;
      error: { code: string; operation: string; flagKey: string; message: string };
    };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('KILL_SWITCH_ACTIVE');
    expect(body.error.operation).toBe('account-deletion');
    expect(body.error.flagKey).toBe('killswitch_account_deletion');
    expect(body.error.message).toMatch(/disabled/i);
  });

  it('emits a structured audit event when the kill-switch fires', async () => {
    const app = new Hono();
    const flags = makeFlags({ [KILL_SWITCH_FLAG_KEYS['eviction']]: true });
    const audit = vi.fn();

    app.use('*', withAuth('tenant-42', 'user-7'));
    app.use('*', withServices(flags));
    app.post(
      '/leases/L1/terminate',
      killSwitchGuard('eviction', { emitAudit: audit }),
      (c) => c.json({ ok: true }),
    );

    const res = await app.request('/leases/L1/terminate', { method: 'POST' });
    expect(res.status).toBe(503);
    expect(audit).toHaveBeenCalledOnce();
    const event = audit.mock.calls[0][0] as KillSwitchAuditEvent;
    expect(event.operation).toBe('eviction');
    expect(event.flagKey).toBe('killswitch_eviction');
    expect(event.tenantId).toBe('tenant-42');
    expect(event.userId).toBe('user-7');
    expect(event.path).toBe('/leases/L1/terminate');
    expect(event.method).toBe('POST');
    expect(typeof event.timestampMs).toBe('number');
  });

  it('still returns 503 when the audit emitter throws', async () => {
    // Kill-switch is the load-bearing path — audit is best-effort.
    const app = new Hono();
    const flags = makeFlags({
      [KILL_SWITCH_FLAG_KEYS['payment-reversal']]: true,
    });
    const audit = vi.fn().mockRejectedValue(new Error('audit store offline'));

    app.use('*', withAuth('t1'));
    app.use('*', withServices(flags));
    app.post(
      '/payments/p1/reverse',
      killSwitchGuard('payment-reversal', { emitAudit: audit }),
      (c) => c.json({ ok: true }),
    );

    const res = await app.request('/payments/p1/reverse', { method: 'POST' });
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('KILL_SWITCH_ACTIVE');
  });
});

describe('killSwitchGuard — degraded paths', () => {
  it('passes through when the feature-flags service is null (degraded mode)', async () => {
    const app = new Hono();
    const audit = vi.fn();

    app.use('*', withAuth('t1'));
    app.use('*', withServices(null));
    app.post(
      '/leases/L1/terminate',
      killSwitchGuard('eviction', { emitAudit: audit }),
      (c) => c.json({ ok: true }),
    );

    const res = await app.request('/leases/L1/terminate', { method: 'POST' });
    expect(res.status).toBe(200);
    expect(audit).not.toHaveBeenCalled();
  });

  it('passes through when no auth context is present', async () => {
    // The route's own auth middleware will reject; kill-switch should
    // not double-gate.
    const app = new Hono();
    const flags = makeFlags({ [KILL_SWITCH_FLAG_KEYS['eviction']]: true });
    const audit = vi.fn();

    app.use('*', withAuth(null));
    app.use('*', withServices(flags));
    app.post(
      '/leases/L1/terminate',
      killSwitchGuard('eviction', { emitAudit: audit }),
      (c) => c.json({ ok: true }),
    );

    const res = await app.request('/leases/L1/terminate', { method: 'POST' });
    expect(res.status).toBe(200);
    expect(audit).not.toHaveBeenCalled();
  });

  it('passes through when the flag lookup throws in dev/test (fast local loop) + WARN', async () => {
    // DA1 update: in dev/test, lookup errors still pass through so a
    // missing DB doesn't break the local iteration loop. A structured
    // WARN goes to stderr so the breadcrumb is visible to operators.
    //
    // DA1 MEDIUM rework: warn now flows through the project's structured
    // logger (`utils/logger.ts`), which routes WARN through `console.warn`
    // with NODE_ENV-dependent formatting:
    //   - production → single-line JSON entry
    //   - dev/test   → readable text + pretty-printed JSON meta
    // Assert against substring fragments to stay robust across formats.
    const originalEnv = process.env.NODE_ENV;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      process.env.NODE_ENV = 'development';
      const app = new Hono();
      const audit = vi.fn();
      const flakeyFlags: KillSwitchFeatureFlagsLike = {
        async isEnabled() {
          throw new Error('database connection lost');
        },
      };

      app.use('*', withAuth('t1'));
      app.use('*', withServices(flakeyFlags));
      app.post(
        '/leases/L1/terminate',
        killSwitchGuard('eviction', { emitAudit: audit }),
        (c) => c.json({ ok: true }),
      );

      const res = await app.request('/leases/L1/terminate', { method: 'POST' });
      expect(res.status).toBe(200);
      expect(audit).not.toHaveBeenCalled();
      // A WARN line must be emitted so SRE can correlate the bypass.
      expect(warn).toHaveBeenCalled();
      const warnPayload = String(warn.mock.calls[0][0]);
      expect(warnPayload).toContain('kill_switch_flag_lookup_failed');
      expect(warnPayload).toContain('eviction');
      expect(warnPayload).toContain('database connection lost');
      // Tenant ID must be on the structured payload so SRE can correlate.
      expect(warnPayload).toContain('t1');
    } finally {
      process.env.NODE_ENV = originalEnv;
      warn.mockRestore();
    }
  });

  it('fails CLOSED with 503 KILL_SWITCH_LOOKUP_FAILED when the flag lookup throws in production (DA1 HIGH)', async () => {
    // DA1 HIGH: prior behaviour silently bypassed the kill-switch on any
    // DB blip / RLS denial / network hiccup. New contract: production
    // refuses the irreversible mutation fail-closed.
    const originalEnv = process.env.NODE_ENV;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      process.env.NODE_ENV = 'production';
      const app = new Hono();
      const audit = vi.fn();
      const flakeyFlags: KillSwitchFeatureFlagsLike = {
        async isEnabled() {
          throw new Error('RLS policy violation: tenant context missing');
        },
      };

      app.use('*', withAuth('t1', 'alice'));
      app.use('*', withServices(flakeyFlags));
      app.post(
        '/leases/L1/terminate',
        killSwitchGuard('eviction', { emitAudit: audit }),
        (c) => c.json({ ok: true }),
      );

      const res = await app.request('/leases/L1/terminate', { method: 'POST' });
      expect(res.status).toBe(503);
      const body = (await res.json()) as {
        success: boolean;
        error: { code: string; operation: string; flagKey: string; message: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('KILL_SWITCH_LOOKUP_FAILED');
      expect(body.error.operation).toBe('eviction');
      expect(body.error.flagKey).toBe('killswitch_eviction');
      expect(body.error.message).toMatch(/cannot verify/i);
      // Lookup failure is structural, not a fired switch — no audit event.
      expect(audit).not.toHaveBeenCalled();
      // WARN must still fire so SRE sees the underlying cause.
      expect(warn).toHaveBeenCalled();
    } finally {
      process.env.NODE_ENV = originalEnv;
      warn.mockRestore();
    }
  });
});

describe('killSwitchGuard — type guard', () => {
  it('throws when constructed with an unknown operation', () => {
    expect(() =>
      // @ts-expect-error — intentional bad input
      killSwitchGuard('not-a-real-op'),
    ).toThrow(/unknown operation/i);
  });

  it('exposes the canonical list of flag keys for migration tooling', () => {
    expect(ALL_KILL_SWITCH_FLAG_KEYS).toEqual([
      'killswitch_eviction',
      'killswitch_payment_reversal',
      'killswitch_account_deletion',
      'killswitch_refund',
      'killswitch_data_export',
      'killswitch_monthly_close_reverse',
      'killswitch_sublease_cancel',
      'killswitch_sovereign_ledger_override',
    ]);
  });

  it('flag keys match the snake_case validator regex /^[a-z][a-z0-9_]*$/', () => {
    // The feature-flags service rejects any key that doesn't match this
    // pattern — guarantee the keys we emit are admissible.
    const re = /^[a-z][a-z0-9_]*$/;
    for (const key of ALL_KILL_SWITCH_FLAG_KEYS) {
      expect(key).toMatch(re);
    }
  });
});
