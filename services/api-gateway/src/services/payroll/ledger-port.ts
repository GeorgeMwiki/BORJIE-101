/**
 * Payroll -> LedgerService port (issue #193 chain L-B).
 *
 * Why a port (not a direct import of `LedgerService`)?
 *   - The api-gateway composition root wires the real
 *     `services/payments-ledger/src/services/ledger.service.ts` once.
 *     Per-feature modules should not reach into the ledger package
 *     directly — it bloats the type graph and couples the route file
 *     to the ledger's internal `CreateJournalEntryRequest` shape.
 *   - Tests replace this port with an in-memory adapter.
 *
 * The CLAUDE.md hard rule still holds: at runtime the
 * `defaultLedgerPort` resolution lands on `LedgerService.post()`.
 * This module simply provides the per-feature seam.
 */

export interface PayrollPostInput {
  readonly tenantId: string;
  readonly workerUserId: string;
  readonly payrollRunId: string;
  readonly netTzs: number;
  /**
   * Idempotency-key composed of run + worker — replays short-circuit
   * inside the LedgerService.
   */
  readonly idempotencyKey: string;
}

export interface PayrollPostResult {
  /** The journal id returned by LedgerService.post(). */
  readonly journalId: string;
}

export interface PayrollLedgerPort {
  post(input: PayrollPostInput): Promise<PayrollPostResult>;
}

let portOverride: PayrollLedgerPort | null = null;
let portProduction: PayrollLedgerPort | null = null;
// Fail-loud guard (M1) — see settlement/index.ts. The dev stub writes
// NOTHING and returns a fake journal id; if reached when a database
// exists, payroll would stamp posted + fire a real payout with no ledger
// entry. The stub is reachable ONLY after the composition root declares
// no-db mode via `__allowPayrollLedgerStub(true)`.
let portStubAllowed = false;

/** Test-only seam (wins over production + stub). */
export function __setPayrollLedgerPortForTests(
  port: PayrollLedgerPort | null,
): void {
  portOverride = port;
}

/**
 * Composition-root seam — register the REAL LedgerService-backed adapter.
 * Installed once at boot by `composition/ledger`. Takes precedence over
 * the dev stub but NOT over a test override.
 */
export function __setPayrollProductionLedgerPort(
  port: PayrollLedgerPort | null,
): void {
  portProduction = port;
}

/**
 * Composition-root seam (M1) — declare the dev stub is allowed because
 * there is NO database. Called from `registerProductionLedgerPorts` ONLY
 * in the `db === null` branch. When never called, `resolvePayrollLedgerPort`
 * fails loud rather than returning the money-losing stub.
 */
export function __allowPayrollLedgerStub(allowed: boolean): void {
  portStubAllowed = allowed;
}

/**
 * Resolve the active payroll ledger port. Resolution order:
 *   1. test override (in-memory adapter), when set;
 *   2. production adapter wrapping the REAL `LedgerService.post()` from
 *      `@borjie/payments-ledger-service`, registered once at boot by
 *      `composition/ledger` (CLAUDE.md hard rule — the live money path);
 *   3. dev stub — ONLY reached when neither is wired AND the composition
 *      root declared no-db mode (`__allowPayrollLedgerStub`). It writes
 *      NOTHING and returns a deterministic SHA-256 journal id purely so dev
 *      flows complete.
 *
 * If a database EXISTS but no production port is registered, this throws a
 * loud `LEDGER_NOT_WIRED` (M1) — never the money-losing stub.
 */
export function resolvePayrollLedgerPort(): PayrollLedgerPort {
  if (portOverride) return portOverride;
  if (portProduction) return portProduction;
  if (!portStubAllowed) {
    throw new Error(
      'LEDGER_NOT_WIRED: payroll ledger port is not wired — a database is ' +
        'present but the production LedgerService adapter was not registered ' +
        '(boot wiring failed). Refusing the dev stub, which would post ' +
        'NOTHING to the ledger while a real payout fires.',
    );
  }
  return {
    async post(input) {
      // Deterministic dev journal id keyed on (run, worker) so replays
      // produce the same id. Dev-only — writes nothing.
      const seed = `${input.payrollRunId}:${input.workerUserId}:${input.idempotencyKey}`;
      const journalId = `payroll-jrn-${hashHex(seed).slice(0, 16)}`;
      return { journalId };
    },
  };
}

function hashHex(input: string): string {
  // node:crypto is available in the api-gateway runtime; we avoid a
  // top-level import so this module stays bundleable in tests that
  // mock node:crypto wholesale.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const crypto = require('node:crypto') as typeof import('node:crypto');
  return crypto.createHash('sha256').update(input).digest('hex');
}
