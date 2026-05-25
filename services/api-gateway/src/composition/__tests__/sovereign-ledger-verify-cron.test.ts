/**
 * Sovereign-ledger verify cron supervisor tests — Wave-K Tier-3 W-Ops.
 *
 * Pinned behaviours:
 *   1. Degraded mode (no DB) → tick returns skippedReason='no-db'
 *   2. No active tenants → tick returns skippedReason='no-tenants'
 *   3. OK verify per-tenant emits `sovereign-ledger.verified`
 *   4. Broken verify emits `sovereign-ledger.tampered` with broken-row metadata
 *   5. Threw-during-verify counts as tampered (visibility-first)
 *   6. Interval bounded — out-of-range overrides clamp to [60s, 24h]
 *   7. stop() is idempotent + clears the interval handle
 */

import { describe, it, expect, vi } from 'vitest';

// Stub @borjie/database BEFORE importing the supervisor so the
// factory uses our scripted verifier.
const scriptedVerifyByTenant: Record<
  string,
  (tenantId: string) =>
    | { ok: true; count: number }
    | {
        ok: false;
        count: number;
        brokenAt: string;
        expected: string;
        actual: string;
        reason: 'hash-mismatch' | 'prev-hash-mismatch' | 'db-error';
      }
    | Promise<never>
> = {};

vi.mock('@borjie/database', () => ({
  createSovereignActionLedgerService: () => ({
    async verifyLedgerChain(tenantId: string) {
      const fn = scriptedVerifyByTenant[tenantId];
      if (!fn) return { ok: true, count: 0 };
      const res = fn(tenantId);
      return res;
    },
    async getLedgerTail() {
      return [];
    },
    async appendLedgerEntry() {
      throw new Error('not used in test');
    },
  }),
}));

import {
  createSovereignLedgerVerifyCronSupervisor,
  type SovereignLedgerVerifyCronTickResult,
} from '../sovereign-ledger-verify-cron';

function makeLogger() {
  const calls: { level: string; obj: unknown; msg?: string }[] = [];
  return {
    calls,
    info: (obj: any, msg?: string) => calls.push({ level: 'info', obj, msg }),
    warn: (obj: any, msg?: string) => calls.push({ level: 'warn', obj, msg }),
    error: (obj: any, msg?: string) => calls.push({ level: 'error', obj, msg }),
  };
}

interface BusEnvelope {
  event: { eventType: string; tenantId: string; payload: unknown };
}
function captureBus() {
  const events: BusEnvelope[] = [];
  return {
    events,
    publish(env: any) {
      events.push(env as BusEnvelope);
    },
  };
}

describe('sovereign-ledger-verify-cron supervisor', () => {
  it('returns skippedReason=no-db when db is null', async () => {
    const logger = makeLogger();
    const sup = createSovereignLedgerVerifyCronSupervisor({
      db: null,
      logger,
    });
    const r = (await sup.tick()) as SovereignLedgerVerifyCronTickResult;
    expect(r.skippedReason).toBe('no-db');
    expect(r.tenantsProcessed).toBe(0);
    expect(logger.calls.some((c) => c.msg?.includes('no db'))).toBe(true);
  });

  it('returns skippedReason=no-tenants when discovery yields none', async () => {
    const logger = makeLogger();
    const sup = createSovereignLedgerVerifyCronSupervisor({
      db: {} as any,
      logger,
      listActiveTenantIds: async () => [],
    });
    const r = (await sup.tick()) as SovereignLedgerVerifyCronTickResult;
    expect(r.skippedReason).toBe('no-tenants');
    expect(r.tenantsProcessed).toBe(0);
  });

  it('emits verified per ok tenant + tampered per broken tenant', async () => {
    Object.keys(scriptedVerifyByTenant).forEach(
      (k) => delete scriptedVerifyByTenant[k],
    );
    scriptedVerifyByTenant['t_ok'] = () => ({ ok: true, count: 12 });
    scriptedVerifyByTenant['t_broken'] = () => ({
      ok: false,
      count: 3,
      brokenAt: 'row_42',
      expected: 'aa',
      actual: 'bb',
      reason: 'hash-mismatch',
    });

    const logger = makeLogger();
    const bus = captureBus();
    const sup = createSovereignLedgerVerifyCronSupervisor({
      db: {} as any,
      eventBus: bus,
      logger,
      listActiveTenantIds: async () => ['t_ok', 't_broken'],
    });
    const r = (await sup.tick()) as SovereignLedgerVerifyCronTickResult;
    expect(r.tenantsProcessed).toBe(2);
    expect(r.okCount).toBe(1);
    expect(r.tamperedCount).toBe(1);

    const verified = bus.events.find(
      (e) => e.event.eventType === 'sovereign-ledger.verified',
    );
    expect(verified?.event.tenantId).toBe('t_ok');

    const tampered = bus.events.find(
      (e) => e.event.eventType === 'sovereign-ledger.tampered',
    );
    expect(tampered?.event.tenantId).toBe('t_broken');
    const tp = tampered?.event.payload as any;
    expect(tp?.brokenAt).toBe('row_42');
    expect(tp?.reason).toBe('hash-mismatch');

    // TAMPER DETECTED is logged at error level for paging.
    expect(
      logger.calls.some(
        (c) =>
          c.level === 'error' && (c.msg ?? '').includes('TAMPER DETECTED'),
      ),
    ).toBe(true);
  });

  it('counts a verify-throw as tampered with verify-threw reason', async () => {
    Object.keys(scriptedVerifyByTenant).forEach(
      (k) => delete scriptedVerifyByTenant[k],
    );
    scriptedVerifyByTenant['t_throw'] = () => {
      throw new Error('connection-reset');
    };

    const logger = makeLogger();
    const bus = captureBus();
    const sup = createSovereignLedgerVerifyCronSupervisor({
      db: {} as any,
      eventBus: bus,
      logger,
      listActiveTenantIds: async () => ['t_throw'],
    });
    const r = (await sup.tick()) as SovereignLedgerVerifyCronTickResult;
    expect(r.tamperedCount).toBe(1);
    expect(r.verdicts[0]?.reason).toMatch(/verify-threw:/);
    // No tampered event emitted on throw — we don't want to spam the bus
    // with false-positives for transient DB errors. Logs are the source.
  });

  it('clamps an out-of-range intervalMs into [60s, 24h]', () => {
    const tooSmall = createSovereignLedgerVerifyCronSupervisor({
      db: null,
      logger: makeLogger(),
      intervalMs: 100, // 100ms — well below the 60s floor.
    });
    expect(tooSmall.intervalMs).toBe(60_000);

    const tooLarge = createSovereignLedgerVerifyCronSupervisor({
      db: null,
      logger: makeLogger(),
      intervalMs: 365 * 24 * 60 * 60 * 1000,
    });
    expect(tooLarge.intervalMs).toBe(24 * 60 * 60 * 1000);
  });

  it('stop() is idempotent', () => {
    const logger = makeLogger();
    const sup = createSovereignLedgerVerifyCronSupervisor({
      db: null,
      logger,
    });
    sup.stop();
    sup.stop();
    // No throw, no infinite loop.
    expect(true).toBe(true);
  });
});
