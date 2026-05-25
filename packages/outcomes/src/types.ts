/**
 * Outcome-as-a-Service — public types.
 *
 * BORJIE is migrating from per-seat SaaS to outcome-priced services
 * (per the Sequoia / Bessemer 2026 thesis). Three first monetizable
 * outcomes:
 *
 *   1. Ticket resolved within SLA — $5-15/ticket
 *      Ground truth: work-order system + tenant confirmation.
 *   2. Rent collected — 1-3% of collected + 10% of recovered delinquency
 *      Ground truth: bank reconciliation.
 *   3. Vacancy filled — 0.5-1 month rent per executed lease
 *      Ground truth: signed lease + move-in.
 *
 * This file contains ONLY types — pure contracts. No runtime, no I/O.
 * Scorers (per outcome) and the counterfactual baseline live in their
 * own files and depend on this one.
 *
 * Invariants the type system enforces:
 *   - Every outcome event is bound to a tenant (cross-tenant leakage
 *     is impossible by construction).
 *   - Every billable metering record carries a stability window (so
 *     the billing engine knows when the clawback period closes).
 *   - PriceUnit is a discriminated union so the billing rule for each
 *     outcome cannot be swapped silently.
 */
import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────
// Outcome kinds — the canonical first-three. Adding a fourth requires
// updating the catalog, adding a scorer, and exhaustive-switching every
// consumer (assertExhaustiveOutcomeKind below).
// ─────────────────────────────────────────────────────────────────────

export const OUTCOME_KINDS = [
  'ticket_resolved_within_sla',
  'rent_collected',
  'vacancy_filled',
] as const;

export type OutcomeKind = (typeof OUTCOME_KINDS)[number];

export const OutcomeKindSchema = z.enum(OUTCOME_KINDS);

// ─────────────────────────────────────────────────────────────────────
// PriceUnit — discriminated union. The billing rule for each outcome
// is a distinct shape so a "per_ticket" outcome cannot be priced like
// a "percentage_of" outcome by mistake.
//
// All currency amounts are in MINOR units (cents) so we never round
// during arithmetic. Currency code is ISO-4217 alpha-3.
// ─────────────────────────────────────────────────────────────────────

export interface PriceUnitPerEvent {
  readonly kind: 'per_event';
  readonly currency: string;            // ISO-4217 alpha-3, e.g. 'USD'
  readonly amountMinor: number;         // cents per event
  readonly capFractionOfHumanCost?: number; // e.g. 0.95 → never exceed 95% of human cost
}

export interface PriceUnitPercentage {
  readonly kind: 'percentage_of';
  readonly basisPoints: number;         // 100 bp = 1%
  /** Which scored field to take the percentage of. */
  readonly appliesTo: 'collected_minor' | 'recovered_delinquency_minor';
  readonly minRetainerMinor?: number;   // floor (e.g. min $200/property/mo)
  readonly currency: string;            // ISO-4217 alpha-3
}

export interface PriceUnitFractionOfRent {
  readonly kind: 'fraction_of_monthly_rent';
  readonly fraction: number;            // e.g. 0.5 → half a month's rent
  readonly currency: string;            // ISO-4217 alpha-3
}

export type PriceUnit =
  | PriceUnitPerEvent
  | PriceUnitPercentage
  | PriceUnitFractionOfRent;

// Zod schema — inferred (not annotated z.ZodType<PriceUnit>) because
// exactOptionalPropertyTypes refuses to unify `optional()` with
// `field?: number` (Zod yields `number | undefined`, the interface
// requires the key to be absent rather than undefined). The schema
// still validates the same runtime shape; consumers parse and then
// cast to PriceUnit at the boundary if they need the strict type.
export const PriceUnitSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('per_event'),
    currency: z.string().length(3),
    amountMinor: z.number().int().min(0),
    capFractionOfHumanCost: z.number().min(0).max(1).optional(),
  }),
  z.object({
    kind: z.literal('percentage_of'),
    basisPoints: z.number().int().min(0).max(10_000),
    appliesTo: z.enum(['collected_minor', 'recovered_delinquency_minor']),
    minRetainerMinor: z.number().int().min(0).optional(),
    currency: z.string().length(3),
  }),
  z.object({
    kind: z.literal('fraction_of_monthly_rent'),
    fraction: z.number().min(0).max(2),
    currency: z.string().length(3),
  }),
]);

// ─────────────────────────────────────────────────────────────────────
// Outcome — the catalog entry. Defines what we price, how we attribute
// it, and where ground truth comes from. Customer-visible.
// ─────────────────────────────────────────────────────────────────────

export type AttributionRule =
  /** AI gets credit only on actions it executed end-to-end. */
  | 'agent_executed_end_to_end'
  /** AI gets credit on a delta above a prior-12mo counterfactual baseline. */
  | 'counterfactual_delta_vs_prior_12mo'
  /** AI gets credit per closed unit of work (e.g. per signed lease). */
  | 'per_closed_unit_of_work';

export type GroundTruthSource =
  | 'work_order_system_plus_tenant_confirmation'
  | 'bank_reconciliation'
  | 'signed_lease_plus_move_in';

export interface Outcome {
  readonly kind: OutcomeKind;
  readonly displayName: string;
  readonly description: string;
  readonly pricing: ReadonlyArray<PriceUnit>;
  readonly attributionRule: AttributionRule;
  readonly groundTruthSource: GroundTruthSource;
  /** Days the billing event is reversible after creation. */
  readonly clawbackWindowDays: number;
}

// ─────────────────────────────────────────────────────────────────────
// OutcomeEvent — what gets emitted by an agent or workflow when it
// believes an outcome has occurred. Submitted to the scorer, which
// decides whether the event qualifies and (if so) produces a billable
// MeteringRecord.
//
// Discriminated by `kind` so each outcome's payload is statically
// typed. New outcome → new payload shape → exhaustive switch error
// in every consumer.
// ─────────────────────────────────────────────────────────────────────

interface OutcomeEventBase {
  readonly eventId: string;
  readonly tenantId: string;
  readonly propertyId: string;
  readonly agentId: string;
  /** ISO timestamp when the agent claims the outcome occurred. */
  readonly occurredAt: string;
  /** [0,1] confidence reported by the agent's confidence-router. */
  readonly confidence: number;
  /** Pointer to evidence bundle hash (WORM bucket etc.). */
  readonly evidenceHash: string;
}

export interface TicketResolvedEvent extends OutcomeEventBase {
  readonly kind: 'ticket_resolved_within_sla';
  readonly ticketId: string;
  /** SLA window the agent committed to, in hours. */
  readonly slaWindowHours: number;
  /** Hours actually taken from open → fix. */
  readonly resolutionTimeHours: number;
  /** True iff the tenant explicitly confirmed the fix. */
  readonly tenantConfirmed: boolean;
  /** True iff the same ticket re-opened within the clawback window. */
  readonly reopenedWithinWindow: boolean;
}

export interface RentCollectedEvent extends OutcomeEventBase {
  readonly kind: 'rent_collected';
  /** Calendar month bucket (YYYY-MM). Each property gets one event per month. */
  readonly billingPeriod: string;
  /** Total rent collected in the period, minor units. */
  readonly collectedMinor: number;
  /** Of that total, how much was delinquency recovered (vs current rent). */
  readonly recoveredDelinquencyMinor: number;
  /** Prior-12mo baseline collected, minor units, for the same property. */
  readonly baselineCollectedMinor: number;
  /** True iff the payment cleared (bank reconciliation confirmed). */
  readonly bankReconciled: boolean;
  /** True iff the tenant clawed back / charged back within the window. */
  readonly chargedBack: boolean;
}

export interface VacancyFilledEvent extends OutcomeEventBase {
  readonly kind: 'vacancy_filled';
  readonly unitId: string;
  readonly leaseId: string;
  /** True iff the lease has been countersigned by tenant + agent. */
  readonly leaseExecuted: boolean;
  /** True iff the tenant has physically moved in. */
  readonly moveInCompleted: boolean;
  /** Monthly rent on the executed lease, minor units. */
  readonly monthlyRentMinor: number;
  /** Currency of the lease, ISO-4217 alpha-3. */
  readonly currency: string;
  /** True iff the lease was cancelled within the clawback window. */
  readonly cancelledWithinWindow: boolean;
}

export type OutcomeEvent =
  | TicketResolvedEvent
  | RentCollectedEvent
  | VacancyFilledEvent;

// ─────────────────────────────────────────────────────────────────────
// MeteringRecord — the output of a scorer. Pure value object: given
// the same OutcomeEvent + Outcome catalog entry, the scorer produces
// the same MeteringRecord deterministically. The billing engine then
// turns this into an invoice line + escrow hold.
//
// `qualified=false` is a valid scorer output — it means the event did
// NOT meet the outcome's criteria. We still record it (for audit) but
// the billing engine ignores it.
// ─────────────────────────────────────────────────────────────────────

export interface MeteringRecord {
  readonly recordId: string;
  readonly outcomeKind: OutcomeKind;
  readonly tenantId: string;
  readonly propertyId: string;
  readonly eventId: string;
  /** True iff the event qualifies under the outcome's scoring rule. */
  readonly qualified: boolean;
  /** Human-readable reason (esp. when !qualified). */
  readonly reason: string;
  /** Billable amount in minor units. 0 when !qualified. */
  readonly billableAmountMinor: number;
  readonly currency: string;
  /** Which PriceUnit from the catalog was applied. */
  readonly priceUnitApplied: PriceUnit | null;
  /** Wall-clock when the scorer produced this record. */
  readonly scoredAt: string;
  /** When the billing event becomes irreversible. */
  readonly clawbackClosesAt: string;
}

// See PriceUnitSchema for why this is not annotated z.ZodType<MeteringRecord>.
export const MeteringRecordSchema = z.object({
  recordId: z.string().min(1),
  outcomeKind: OutcomeKindSchema,
  tenantId: z.string().min(1),
  propertyId: z.string().min(1),
  eventId: z.string().min(1),
  qualified: z.boolean(),
  reason: z.string(),
  billableAmountMinor: z.number().int().min(0),
  currency: z.string().length(3),
  priceUnitApplied: PriceUnitSchema.nullable(),
  scoredAt: z.string(),
  clawbackClosesAt: z.string(),
});

// ─────────────────────────────────────────────────────────────────────
// Counterfactual baseline — for outcomes priced on a delta vs prior
// 12 months (rent_collected). The baseline is computed per property
// from at least N months of history; below the floor we refuse to
// price on a delta and the billing engine falls back to the floor
// retainer.
// ─────────────────────────────────────────────────────────────────────

export interface BaselineMonthSample {
  /** Calendar month bucket (YYYY-MM). */
  readonly month: string;
  /** Rent collected in that month, minor units. */
  readonly collectedMinor: number;
}

export interface CounterfactualBaseline {
  readonly propertyId: string;
  /** Mean monthly collected, minor units, across the sample. */
  readonly meanMonthlyCollectedMinor: number;
  /** Standard deviation across the sample. */
  readonly stddevMonthlyCollectedMinor: number;
  /** Number of months in the sample (≥ minMonths). */
  readonly months: number;
  /** True iff the sample met the minimum size threshold. */
  readonly trustworthy: boolean;
}

// ─────────────────────────────────────────────────────────────────────
// Exhaustiveness helper — use at the end of every OutcomeKind switch.
// ─────────────────────────────────────────────────────────────────────

export function assertExhaustiveOutcomeKind(value: never): never {
  throw new Error(`outcomes: unhandled outcome kind ${String(value)}`);
}
