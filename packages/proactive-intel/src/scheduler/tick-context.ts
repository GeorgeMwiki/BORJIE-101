/**
 * TickContext — what a single brain-tick is given.
 *
 * The outer scheduler (BullMQ or similar) constructs one of these per
 * (tenant or platform-internal, cadence) job and hands it to
 * `runTick`. Composed of *already-fetched* inputs so the runner stays
 * pure — no fan-out queries from inside.
 */
import type {
  CashflowForecastSlice,
  ArrearsSeries,
  CustomerOwnerSignal,
  CostObservation,
  SloObservation,
  ComplianceDeadline,
  VendorOnTimeHistory,
} from '../contracts/forecast-input.js';

export interface TickInputs {
  readonly cashflow?: CashflowForecastSlice;
  readonly arrears?: ArrearsSeries;
  readonly customerOwners?: ReadonlyArray<CustomerOwnerSignal>;
  readonly cost?: CostObservation;
  readonly slo?: ReadonlyArray<SloObservation>;
  readonly complianceDeadlines?: ReadonlyArray<ComplianceDeadline>;
  readonly vendors?: ReadonlyArray<VendorOnTimeHistory>;
  /**
   * Opportunity-side inputs — see opportunities/* for the per-detector
   * shapes. Held loosely typed here to keep tick-context.ts small; the
   * registry-dispatch handles the per-kind narrowing.
   */
  readonly opportunityInputs?: Readonly<Record<string, unknown>>;
}

export interface TickContext {
  readonly scope: 'tenant' | 'platform-internal';
  readonly tenantId: string | null;
  readonly nowMs: number;
  readonly inputs: TickInputs;
}
