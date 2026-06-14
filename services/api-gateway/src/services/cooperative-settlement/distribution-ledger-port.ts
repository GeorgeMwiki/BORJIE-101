/**
 * Cooperative-distribution ledger port — resolver seam.
 *
 * Symmetric with the settlement ledger port (`services/settlement/index.ts`):
 * the distribute route resolves the active port through `resolve…()`, which
 * prefers a test override, then the production adapter registered at boot,
 * and otherwise FAILS LOUD with `COOP_DISTRIBUTION_LEDGER_NOT_WIRED` rather
 * than silently no-op-posting (the original defect — stamping members paid
 * while NOTHING reached the double-entry ledger).
 *
 * The production adapter is `productionCooperativeDistributionLedgerPort`
 * from `composition/ledger/cooperative-distribution.ts`; it is registered
 * once at boot from `registerProductionLedgerPorts(db)` (db !== null) and the
 * no-db dev mode explicitly allows a fail-closed degrade. There is no
 * fabricated-success stub: with no database the distribute route already 503s
 * via the database middleware, so the port is simply never reached.
 */

import type {
  CooperativeDistributionLedgerPort,
} from '../../composition/ledger/cooperative-distribution';

let portOverride: CooperativeDistributionLedgerPort | null = null;
let portProduction: CooperativeDistributionLedgerPort | null = null;

/** Test seam — override the port (wins over production). */
export function __setCooperativeDistributionLedgerPortForTests(
  port: CooperativeDistributionLedgerPort | null,
): void {
  portOverride = port;
}

/**
 * Composition-root seam — register the REAL LedgerService-backed adapter.
 * Installed once at boot by `composition/ledger`. Takes precedence over
 * nothing-wired but NOT over a test override.
 */
export function __setCooperativeDistributionProductionLedgerPort(
  port: CooperativeDistributionLedgerPort | null,
): void {
  portProduction = port;
}

/**
 * Resolve the active cooperative-distribution ledger port. Resolution order:
 *   1. test override, when set;
 *   2. production adapter wrapping the REAL `LedgerService.post()`.
 *
 * If neither is wired, this throws a loud
 * `COOP_DISTRIBUTION_LEDGER_NOT_WIRED` — never a money-losing silent no-op.
 * The distribute route catches it and returns a fail-closed error envelope so
 * NO member is marked paid without a backing ledger journal.
 */
export function resolveCooperativeDistributionLedgerPort(): CooperativeDistributionLedgerPort {
  if (portOverride) return portOverride;
  if (portProduction) return portProduction;
  throw new CooperativeDistributionLedgerNotWiredError(
    'Cooperative-distribution ledger port is not wired: the production ' +
      'LedgerService adapter was not registered at boot. Refusing to mark ' +
      'members paid without posting a balanced double-entry journal.',
  );
}

/** Thrown by the resolver when no port is wired — caught by the route. */
export class CooperativeDistributionLedgerNotWiredError extends Error {
  readonly code = 'COOP_DISTRIBUTION_LEDGER_NOT_WIRED';
  constructor(message: string) {
    super(message);
    this.name = 'CooperativeDistributionLedgerNotWiredError';
  }
}
