/**
 * AI audit-chain verify cron supervisor tests — Phase D D2.
 *
 * Pinned behaviours:
 *   1. Degraded mode (no verifier) → tick returns skippedReason='no-verifier'
 *   2. No active tenants → skippedReason='no-tenants'
 *   3. Sample tick calls verifyRandomSample with p=0.05 by default
 *   4. Chain tick calls verifyLedgerChain
 *   5. Tampered verdict emits `ai-audit.tampered` + ERROR log
 *   6. Throw-during-verify counts as tampered (visibility-first)
 *   7. Intervals clamp to [60s, 7d]
 *   8. In-flight guard: a slow tick prevents an overlapping tick
 *   9. start() + stop() are idempotent
 *  10. start() arms BOTH the sample timer + chain timer
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createAuditVerifyCronSupervisor,
  type AuditChainVerifierPort,
  type AuditVerifyCronTickResult,
} from '../audit-verify-cron';

function makeLogger() {
  const calls: { level: string; obj: unknown; msg?: string }[] = [];
  return {
    calls,
    info: (obj: any, msg?: string) => calls.push({ level: 'info', obj, msg }),
    warn: (obj: any, msg?: string) => calls.push({ level: 'warn', obj, msg }),
    error: (obj: any, msg?: string) =>
      calls.push({ level: 'error', obj, msg }),
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

function makeVerifier(
  overrides: Partial<AuditChainVerifierPort> = {},
): AuditChainVerifierPort & {
  sampleCalls: { tenantId: string; p: number }[];
  chainCalls: string[];
} {
  const sampleCalls: { tenantId: string; p: number }[] = [];
  const chainCalls: string[] = [];
  const v: AuditChainVerifierPort = {
    async verifyRandomSample(tenantId, p) {
      sampleCalls.push({ tenantId, p });
      return { valid: true, entriesChecked: 100 };
    },
    async verifyLedgerChain(tenantId) {
      chainCalls.push(tenantId);
      return { valid: true, entriesChecked: 1000 };
    },
    ...overrides,
  };
  return Object.assign(v, { sampleCalls, chainCalls });
}

describe('audit-verify-cron supervisor', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns skippedReason=no-verifier when verifier is null', async () => {
    const logger = makeLogger();
    const sup = createAuditVerifyCronSupervisor({
      verifier: null,
      logger,
    });
    const r = (await sup.tickSample()) as AuditVerifyCronTickResult;
    expect(r.skippedReason).toBe('no-verifier');
    expect(r.tenantsProcessed).toBe(0);
    expect(
      logger.calls.some(
        (c) => c.level === 'warn' && c.msg?.includes('no verifier'),
      ),
    ).toBe(true);
  });

  it('returns skippedReason=no-tenants when discovery yields none', async () => {
    const verifier = makeVerifier();
    const sup = createAuditVerifyCronSupervisor({
      verifier,
      logger: makeLogger(),
      listActiveTenantIds: async () => [],
    });
    const r = (await sup.tickSample()) as AuditVerifyCronTickResult;
    expect(r.skippedReason).toBe('no-tenants');
    expect(verifier.sampleCalls).toHaveLength(0);
  });

  it('sample tick calls verifyRandomSample with p=0.05 per active tenant', async () => {
    const verifier = makeVerifier();
    const sup = createAuditVerifyCronSupervisor({
      verifier,
      logger: makeLogger(),
      listActiveTenantIds: async () => ['t1', 't2', 't3'],
    });
    const r = (await sup.tickSample()) as AuditVerifyCronTickResult;
    expect(r.mode).toBe('sample');
    expect(r.tenantsProcessed).toBe(3);
    expect(r.okCount).toBe(3);
    expect(r.tamperedCount).toBe(0);
    expect(verifier.sampleCalls).toEqual([
      { tenantId: 't1', p: 0.05 },
      { tenantId: 't2', p: 0.05 },
      { tenantId: 't3', p: 0.05 },
    ]);
    expect(verifier.chainCalls).toHaveLength(0);
  });

  it('chain tick calls verifyLedgerChain per active tenant', async () => {
    const verifier = makeVerifier();
    const sup = createAuditVerifyCronSupervisor({
      verifier,
      logger: makeLogger(),
      listActiveTenantIds: async () => ['t1', 't2'],
    });
    const r = (await sup.tickChain()) as AuditVerifyCronTickResult;
    expect(r.mode).toBe('chain');
    expect(verifier.chainCalls).toEqual(['t1', 't2']);
    expect(verifier.sampleCalls).toHaveLength(0);
  });

  it('respects an overridden sampleP', async () => {
    const verifier = makeVerifier();
    const sup = createAuditVerifyCronSupervisor({
      verifier,
      logger: makeLogger(),
      listActiveTenantIds: async () => ['t1'],
      sampleP: 0.25,
    });
    await sup.tickSample();
    expect(verifier.sampleCalls[0]?.p).toBe(0.25);
  });

  it('falls back to default sampleP when invalid', async () => {
    const verifier = makeVerifier();
    const sup = createAuditVerifyCronSupervisor({
      verifier,
      logger: makeLogger(),
      listActiveTenantIds: async () => ['t1'],
      sampleP: -1,
    });
    await sup.tickSample();
    expect(verifier.sampleCalls[0]?.p).toBe(0.05);
  });

  it('emits ai-audit.tampered + logs ERROR on a failed verdict', async () => {
    const verifier = makeVerifier({
      async verifyRandomSample() {
        return {
          valid: false,
          entriesChecked: 17,
          brokenAt: 42,
          error: 'prevHash mismatch at 42',
        };
      },
    });
    const logger = makeLogger();
    const bus = captureBus();
    const sup = createAuditVerifyCronSupervisor({
      verifier,
      logger,
      eventBus: bus,
      listActiveTenantIds: async () => ['t_bad'],
    });
    const r = (await sup.tickSample()) as AuditVerifyCronTickResult;
    expect(r.tamperedCount).toBe(1);
    expect(r.verdicts[0]?.brokenAt).toBe(42);
    expect(r.verdicts[0]?.error).toBe('prevHash mismatch at 42');

    const tampered = bus.events.find(
      (e) => e.event.eventType === 'ai-audit.tampered',
    );
    expect(tampered).toBeDefined();
    expect(tampered?.event.tenantId).toBe('t_bad');
    const pl = tampered?.event.payload as {
      mode: string;
      brokenAt: number | null;
      entriesChecked: number;
    };
    expect(pl.mode).toBe('sample');
    expect(pl.brokenAt).toBe(42);

    expect(
      logger.calls.some(
        (c) => c.level === 'error' && (c.msg ?? '').includes('TAMPER DETECTED'),
      ),
    ).toBe(true);
  });

  it('counts a verifier throw as tampered with verify-threw reason', async () => {
    const verifier = makeVerifier({
      async verifyRandomSample() {
        throw new Error('connection-reset');
      },
    });
    const sup = createAuditVerifyCronSupervisor({
      verifier,
      logger: makeLogger(),
      listActiveTenantIds: async () => ['t_throw'],
    });
    const r = (await sup.tickSample()) as AuditVerifyCronTickResult;
    expect(r.tamperedCount).toBe(1);
    expect(r.verdicts[0]?.error).toMatch(/verify-threw:/);
  });

  it('clamps an out-of-range sampleIntervalMs into [60s, 7d]', () => {
    const tooSmall = createAuditVerifyCronSupervisor({
      verifier: null,
      logger: makeLogger(),
      sampleIntervalMs: 100,
    });
    expect(tooSmall.sampleIntervalMs).toBe(60_000);

    const tooLarge = createAuditVerifyCronSupervisor({
      verifier: null,
      logger: makeLogger(),
      sampleIntervalMs: 365 * 24 * 60 * 60 * 1000,
    });
    expect(tooLarge.sampleIntervalMs).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('clamps an out-of-range chainIntervalMs into [60s, 7d]', () => {
    const sup = createAuditVerifyCronSupervisor({
      verifier: null,
      logger: makeLogger(),
      chainIntervalMs: 1,
    });
    expect(sup.chainIntervalMs).toBe(60_000);
  });

  it('start()+stop() are idempotent (no throw, no leak)', () => {
    const logger = makeLogger();
    const sup = createAuditVerifyCronSupervisor({
      verifier: null,
      logger,
    });
    sup.start();
    sup.start();
    sup.stop();
    sup.stop();
    expect(true).toBe(true);
  });

  it('start() arms both timers (sample + chain) — confirmed by clear count', () => {
    const logger = makeLogger();
    const sup = createAuditVerifyCronSupervisor({
      verifier: null,
      logger,
    });
    const clearSpy = vi.spyOn(global, 'clearInterval');
    sup.start();
    sup.stop();
    // Two clearInterval calls — one per armed timer.
    expect(clearSpy).toHaveBeenCalledTimes(2);
    clearSpy.mockRestore();
  });

  it('in-flight guard: overlapping tick returns skippedReason=inflight', async () => {
    let release: () => void = () => {};
    const slowPromise = new Promise<void>((resolve) => {
      release = resolve;
    });
    const verifier: AuditChainVerifierPort = {
      async verifyRandomSample() {
        await slowPromise;
        return { valid: true, entriesChecked: 1 };
      },
      async verifyLedgerChain() {
        return { valid: true, entriesChecked: 1 };
      },
    };
    const sup = createAuditVerifyCronSupervisor({
      verifier,
      logger: makeLogger(),
      listActiveTenantIds: async () => ['t1'],
    });
    const first = sup.tickSample();
    // Second tick fires while the first is still running.
    const second = await sup.tickSample();
    expect(second?.skippedReason).toBe('inflight');
    release();
    await first;
  });
});
