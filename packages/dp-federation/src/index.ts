/**
 * `@borjie/dp-federation` — public barrel.
 *
 * Wave SELFIMPROVE. Pure-TypeScript differential-privacy primitives:
 *
 *   - Rényi-DP accountant (Mironov 2017 closed-form Gaussian).
 *   - RDP -> (ε, δ) conversion.
 *   - Per-tenant ε-budget tracker with audit-chained charges.
 *   - DP-mean with Gaussian noise (sensitivity 2C/n).
 *
 * Numerics validated against published Mironov 2017 reference vectors.
 * Persona: Mr. Mwikila. Brand: Borjie.
 * Spec: Docs/DESIGN/SELF_IMPROVE_AND_DP_FEDERATION_SPEC.md.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type {
  RdpPoint,
  GaussianApplication,
  DpGuarantee,
  DpCharge,
  EpsilonBudget,
  RdpAccountant,
  DpChargesRepository,
  EpsilonBudgetPort,
  ClockPort,
  UuidPort,
  AuditChainPort,
  Logger,
  ChargeTrackerDeps,
} from './types.js';

export { DEFAULT_RDP_ORDERS } from './types.js';

// ---------------------------------------------------------------------------
// RDP composition
// ---------------------------------------------------------------------------

export {
  createRdpAccountant,
  gaussianRdp,
  RdpAccountantError,
} from './composition/rdp-accountant.js';

export {
  rdpToDp,
  RdpToDpError,
  type RdpToDpParams,
} from './composition/rdp-to-dp.js';

// ---------------------------------------------------------------------------
// Charges
// ---------------------------------------------------------------------------

export {
  createChargeTracker,
  BudgetExhaustedError,
  type ChargeRequest,
  type ChargeOutcome,
} from './charges/charge-tracker.js';

// ---------------------------------------------------------------------------
// Aggregates
// ---------------------------------------------------------------------------

export {
  dpMean,
  gaussianStandardSample,
  DpMeanError,
  type DpMeanParams,
  type DpMeanOutcome,
  type RandomPort,
} from './aggregate/dp-mean.js';

// ---------------------------------------------------------------------------
// Repositories
// ---------------------------------------------------------------------------

export {
  createInMemoryDpChargesRepository,
  createSqlDpChargesRepository,
  type SqlChargesPort,
  type DpChargeRow,
} from './repositories/dp-charges-repository.js';
