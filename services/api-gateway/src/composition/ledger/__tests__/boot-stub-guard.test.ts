/**
 * Boot fail-loud guard (M1) — the dev SHA-256 ledger stub must be
 * UNREACHABLE when a database exists.
 *
 * The dev stub writes NOTHING to the double-entry ledger yet returns a
 * fake journal id. If it were ever the resolution in an environment that
 * HAS a database, the settlement/payroll orchestrators would stamp
 * status='posted' and FIRE a real M-Pesa payout while no ledger entry
 * exists — real money leaving with no record. These tests pin that:
 *
 *   - with NO production port registered and the stub NOT explicitly
 *     allowed (the "DB exists but boot wiring failed" state), both
 *     `resolveSettlementLedgerPort` and `resolvePayrollLedgerPort` throw a
 *     loud LEDGER_NOT_WIRED — they NEVER hand back the stub;
 *   - the stub becomes reachable ONLY after the composition root EXPLICITLY
 *     declares no-db mode via `__allow*LedgerStub(true)` — which
 *     `registerProductionLedgerPorts(null)` does;
 *   - `registerProductionLedgerPorts(null)` flips that allow-flag (no-db
 *     boot still works), while a non-null db registers a REAL port so the
 *     resolver returns it, not the stub.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import {
  resolveSettlementLedgerPort,
  resolveSettlementPayoutPort,
  SettlementError,
  __setSettlementLedgerPortForTests,
  __setSettlementProductionLedgerPort,
  __allowSettlementLedgerStub,
  __setSettlementPayoutPortForTests,
  __setSettlementProductionPayoutPort,
  __allowSettlementPayoutStub,
} from '../../../services/settlement';
import {
  resolvePayrollLedgerPort,
  __setPayrollLedgerPortForTests,
  __setPayrollProductionLedgerPort,
  __allowPayrollLedgerStub,
} from '../../../services/payroll/ledger-port';
import { registerProductionLedgerPorts } from '../index';

/**
 * Reset all module-level resolver state to the pristine "freshly imported"
 * shape: no test override, no production port, stub NOT allowed. This is
 * the state a real process is in BEFORE `registerProductionLedgerPorts`
 * runs — i.e. if wiring fails with a DB present, this is what's left.
 */
function resetLedgerResolverState(): void {
  __setSettlementLedgerPortForTests(null);
  __setSettlementProductionLedgerPort(null);
  __allowSettlementLedgerStub(false);
  __setSettlementPayoutPortForTests(null);
  __setSettlementProductionPayoutPort(null);
  __allowSettlementPayoutStub(false);
  __setPayrollLedgerPortForTests(null);
  __setPayrollProductionLedgerPort(null);
  __allowPayrollLedgerStub(false);
}

beforeEach(() => {
  resetLedgerResolverState();
});

/** Capture a thrown SettlementError so its `.code` can be asserted. */
function catchSettlementError(fn: () => unknown): SettlementError {
  try {
    fn();
  } catch (err) {
    if (err instanceof SettlementError) return err;
    throw err;
  }
  throw new Error('expected the call to throw a SettlementError');
}

describe('settlement ledger port — boot fail-loud guard (M1)', () => {
  it('throws LEDGER_NOT_WIRED when no production port is registered and the stub is not allowed', () => {
    // "DB exists, boot wiring failed" — nothing wired, stub un-allowed.
    const err = catchSettlementError(() => resolveSettlementLedgerPort());
    expect(err.code).toBe('LEDGER_NOT_WIRED');
  });

  it('returns the dev stub ONLY after the stub is explicitly allowed (no-db mode)', async () => {
    __allowSettlementLedgerStub(true);
    const port = resolveSettlementLedgerPort();
    // The stub returns a deterministic `stl-jrn-…` id (writes nothing).
    const res = await port.post({
      tenantId: 't',
      responseId: 'r',
      idempotencyKey: 'k',
      math: { grossTzs: 1, royaltyTzs: 0, feeTzs: 0, netTzs: 1 },
    });
    expect(res.journalId).toMatch(/^stl-jrn-/);
  });

  it('returns the production port (never the stub) once one is registered', () => {
    const sentinel = {
      async post() {
        return { journalId: 'real-journal' };
      },
    };
    __setSettlementProductionLedgerPort(sentinel);
    expect(resolveSettlementLedgerPort()).toBe(sentinel);
  });
});

describe('settlement PAYOUT port — boot fail-loud guard (the silent-stub money bug)', () => {
  it('throws PAYOUT_NOT_WIRED when no production payout port is registered and the stub is not allowed', () => {
    // This pristine state IS the db-present-payout-unwired state: a real boot
    // runs registerProductionLedgerPorts(db), which wires the LEDGER port but
    // deliberately does NOT allow the payout stub (the Tanzania TZS B2C rail is
    // external-blocked). The bug was that resolveSettlementPayoutPort silently
    // returned a stub fabricating a fake mpesa-<sha256> ref while firing NO real
    // transfer — seller stamped 'paying_out', never paid. It must fail loud.
    const err = catchSettlementError(() => resolveSettlementPayoutPort());
    expect(err.code).toBe('PAYOUT_NOT_WIRED');
  });

  it('NEVER hands back the fabricated-success stub when not in no-db mode', () => {
    // It must THROW (never return a port whose payout() fabricates success).
    expect(() => resolveSettlementPayoutPort()).toThrow(SettlementError);
  });

  it('returns the dev stub ONLY after the stub is explicitly allowed (no-db mode)', async () => {
    __allowSettlementPayoutStub(true);
    const res = await resolveSettlementPayoutPort().payout({
      tenantId: 't',
      settlementId: 's',
      netTzs: 1000,
      sellerUserId: 'u',
    });
    // Dev stub returns a deterministic fake ref (fires NO real transfer).
    expect(res.provider).toBe('mpesa_b2c');
    expect(res.providerRef).toMatch(/^mpesa-/);
  });

  it('returns the production payout port (never the stub) once one is registered', () => {
    const sentinel = {
      async payout() {
        return { provider: 'mpesa_b2c' as const, providerRef: 'real-ref' };
      },
    };
    __setSettlementProductionPayoutPort(sentinel);
    expect(resolveSettlementPayoutPort()).toBe(sentinel);
  });

  it('registerProductionLedgerPorts(null) makes the payout stub reachable (no-db boot still works)', () => {
    expect(catchSettlementError(() => resolveSettlementPayoutPort()).code).toBe(
      'PAYOUT_NOT_WIRED',
    );
    registerProductionLedgerPorts(null);
    expect(() => resolveSettlementPayoutPort()).not.toThrow();
  });
});

describe('payroll ledger port — boot fail-loud guard (M1)', () => {
  it('throws LEDGER_NOT_WIRED when no production port is registered and the stub is not allowed', () => {
    expect(() => resolvePayrollLedgerPort()).toThrow(/LEDGER_NOT_WIRED/i);
  });

  it('returns the dev stub ONLY after the stub is explicitly allowed (no-db mode)', async () => {
    __allowPayrollLedgerStub(true);
    const port = resolvePayrollLedgerPort();
    const res = await port.post({
      tenantId: 't',
      workerUserId: 'w',
      payrollRunId: 'run',
      netTzs: 100,
      idempotencyKey: 'run:w',
    });
    expect(res.journalId).toMatch(/^payroll-jrn-/);
  });
});

describe('registerProductionLedgerPorts — no-db branch allows the stub', () => {
  it('flips the stub-allowed flag so resolvers fall back instead of failing loud', async () => {
    // Pristine state: resolving would throw. After register(null) it must
    // resolve to the stub (boot still works without a database).
    expect(catchSettlementError(() => resolveSettlementLedgerPort()).code).toBe(
      'LEDGER_NOT_WIRED',
    );
    expect(() => resolvePayrollLedgerPort()).toThrow(/LEDGER_NOT_WIRED/i);

    registerProductionLedgerPorts(null);

    const stl = resolveSettlementLedgerPort();
    const pay = resolvePayrollLedgerPort();
    const stlRes = await stl.post({
      tenantId: 't',
      responseId: 'r',
      idempotencyKey: 'k',
      math: { grossTzs: 1, royaltyTzs: 0, feeTzs: 0, netTzs: 1 },
    });
    const payRes = await pay.post({
      tenantId: 't',
      workerUserId: 'w',
      payrollRunId: 'run',
      netTzs: 100,
      idempotencyKey: 'run:w',
    });
    expect(stlRes.journalId).toMatch(/^stl-jrn-/);
    expect(payRes.journalId).toMatch(/^payroll-jrn-/);
  });
});
