/**
 * `@borjie/dp-federation` — shared types.
 *
 * Wave SELFIMPROVE. See Docs/DESIGN/SELF_IMPROVE_AND_DP_FEDERATION_SPEC.md.
 *
 * Pure TypeScript — no I/O, no global state. All numerics validated
 * against the published Mironov 2017 closed-form reference for the
 * unsubsampled Gaussian mechanism.
 *
 * References:
 *   - Mironov 2017, "Rényi Differential Privacy", CSF 2017,
 *     https://arxiv.org/abs/1702.07476.
 *   - Dwork & Roth 2014, "The Algorithmic Foundations of Differential
 *     Privacy", FnT TCS,
 *     https://www.cis.upenn.edu/~aaroth/Papers/privacybook.pdf.
 *   - Abadi et al. 2016, "Deep Learning with Differential Privacy",
 *     CCS 2016, https://arxiv.org/abs/1607.00133.
 */

// ---------------------------------------------------------------------------
// Renyi DP curve element
// ---------------------------------------------------------------------------

/**
 * One point on a Rényi-DP curve: ε_α at order α.
 */
export interface RdpPoint {
  /** Rényi order α; must be > 1. */
  readonly order: number;
  /** ε_α at this order. */
  readonly epsilon: number;
}

/**
 * A Gaussian mechanism application: sensitivity is normalised to 1
 * by convention.
 */
export interface GaussianApplication {
  /** Noise scale σ on the standard-Gaussian.
   *  Must be > 0. */
  readonly noiseSigma: number;
  /** Number of times applied (T in DP-SGD). Must be >= 1. */
  readonly steps: number;
}

// ---------------------------------------------------------------------------
// (ε, δ) DP guarantee
// ---------------------------------------------------------------------------

export interface DpGuarantee {
  readonly epsilon: number;
  readonly delta: number;
}

// ---------------------------------------------------------------------------
// Charges (per-operation accounting)
// ---------------------------------------------------------------------------

export interface DpCharge {
  readonly id: string;
  readonly tenantId: string;
  /** First day of the budget period (ISO date YYYY-MM-DD). */
  readonly periodStart: string;
  /** epsilon contributed by this operation. */
  readonly epsilonDelta: number;
  /** dp-mean | dp-sum | dp-count | dp-gradient | ... */
  readonly operation: string;
  readonly opId: string;
  readonly recordedAt: string;
  readonly auditHash: string;
}

// ---------------------------------------------------------------------------
// Per-tenant budget
// ---------------------------------------------------------------------------

/**
 * Per-tenant `(ε_tot, δ_tot)` budget for the period.
 *
 * The strategic-layer's `epsilon_budgets` table stores this for the
 * owner-facing privacy ledger; this package consumes it through an
 * injected `EpsilonBudgetPort`.
 */
export interface EpsilonBudget {
  readonly tenantId: string;
  readonly periodStart: string;
  /** Total ε for the period. */
  readonly epsilonTotal: number;
  /** Total δ for the period. */
  readonly deltaTotal: number;
}

// ---------------------------------------------------------------------------
// Accountant + repository ports
// ---------------------------------------------------------------------------

export interface RdpAccountant {
  /**
   * Compute the RDP curve for a Gaussian application at the given
   * orders. Pure function — no I/O.
   */
  readonly composeGaussian: (
    application: GaussianApplication,
    orders: ReadonlyArray<number>,
  ) => ReadonlyArray<RdpPoint>;

  /**
   * Compose multiple curves (additive in ε_α at fixed α).
   */
  readonly compose: (
    curves: ReadonlyArray<ReadonlyArray<RdpPoint>>,
  ) => ReadonlyArray<RdpPoint>;
}

export interface ChargeTrackerDeps {
  readonly chargesRepository: DpChargesRepository;
  readonly budgetPort: EpsilonBudgetPort;
  readonly clock: ClockPort;
  readonly uuid: UuidPort;
  readonly auditChain: AuditChainPort;
  readonly logger?: Logger;
}

export interface DpChargesRepository {
  readonly insert: (charge: DpCharge) => Promise<void>;
  readonly sumForPeriod: (
    tenantId: string,
    periodStart: string,
  ) => Promise<number>;
  readonly findById: (
    tenantId: string,
    id: string,
  ) => Promise<DpCharge | null>;
  readonly listForPeriod: (
    tenantId: string,
    periodStart: string,
  ) => Promise<ReadonlyArray<DpCharge>>;
}

export interface EpsilonBudgetPort {
  readonly get: (
    tenantId: string,
    periodStart: string,
  ) => Promise<EpsilonBudget>;
}

export interface ClockPort {
  readonly nowIso: () => string;
  readonly nowMs: () => number;
}

export interface UuidPort {
  readonly next: () => string;
}

export interface AuditChainPort {
  readonly hash: (
    prevHash: string | null,
    payload: Readonly<Record<string, unknown>>,
  ) => string;
}

export interface Logger {
  readonly debug: (message: string, meta?: Record<string, unknown>) => void;
  readonly info: (message: string, meta?: Record<string, unknown>) => void;
  readonly warn: (message: string, meta?: Record<string, unknown>) => void;
  readonly error: (message: string, meta?: Record<string, unknown>) => void;
}

// ---------------------------------------------------------------------------
// Default Renyi orders to score at — matches the Mironov 2017 + Apple
// DP standard grid.
// ---------------------------------------------------------------------------

/**
 * Default Rényi orders. The accountant evaluates the RDP curve at
 * each of these points and the converter picks the tightest.
 */
export const DEFAULT_RDP_ORDERS: ReadonlyArray<number> = Object.freeze([
  2, 3, 4, 5, 6, 7, 8, 10, 12, 16, 20, 24, 32, 48, 64, 128, 256, 512, 1024,
]);
