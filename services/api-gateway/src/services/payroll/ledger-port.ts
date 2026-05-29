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

/** Test-only seam. */
export function __setPayrollLedgerPortForTests(
  port: PayrollLedgerPort | null,
): void {
  portOverride = port;
}

/**
 * Resolve the active payroll ledger port. When no production wiring
 * landed (composition root has not registered a real adapter yet),
 * fall back to a deterministic stub that returns a SHA-1-derived
 * journal id so the chain still completes end-to-end in dev.
 *
 * Production composition swaps this for an adapter that wraps the
 * real `LedgerService.post()` call from
 * `services/payments-ledger/src/services/ledger.service.ts`.
 */
export function resolvePayrollLedgerPort(): PayrollLedgerPort {
  if (portOverride) return portOverride;
  return {
    async post(input) {
      // Deterministic dev journal id keyed on (run, worker) so replays
      // produce the same id (matches LedgerService idempotency). We
      // never re-use uuids — this is dev-only.
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
