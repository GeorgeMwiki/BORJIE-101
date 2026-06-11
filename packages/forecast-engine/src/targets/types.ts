/**
 * Forecast-target definition contracts.
 *
 * A target binds a logical prediction ("mineral price", "ore grade",
 * "equipment RUL") to a recommended method, a default horizon, and a
 * data-regime hint, so the router has a domain-aware starting point.
 * These are decision INPUTS that APPEND to rule-based engines; royalty
 * (A6) and licence (A10) stay rule-based authoritative with only a
 * probabilistic overlay on uncertain inputs.
 */

import { z } from 'zod';

/** Recommended primary method for a target. */
export type RecommendedMethod =
  | 'classical-floor' // SeasonalNaive / ETS-Theta
  | 'intermittent' // Croston / TSB
  | 'tsfm' // TS foundation model (escalate only if it beats the floor)
  | 'rule-based+overlay'; // authoritative rule + probabilistic band on inputs

export type Domain = 'mining-estate' | 'real-estate';

export interface ForecastTargetDef {
  /** Stable target id, e.g. 'mining.A1.commodity_price'. */
  readonly id: string;
  readonly domain: Domain;
  /** Short human label. */
  readonly label: string;
  readonly method: RecommendedMethod;
  /** Default horizon in steps for the recommended cadence. */
  readonly defaultHorizon: number;
  /** Recommended conformal target coverage (1 - alpha). */
  readonly targetCoverage: number;
  /**
   * True for HIGH-risk policy domains (treasury / royalty / licence /
   * safety) that are fail-closed + human-gated: advisory only, never an
   * autonomous action.
   */
  readonly highRisk: boolean;
  /** True if money-valued (a surface formats via formatCurrency). */
  readonly monetary: boolean;
}

export const ForecastTargetDefSchema: z.ZodType<ForecastTargetDef> = z.object({
  id: z.string().min(1),
  domain: z.enum(['mining-estate', 'real-estate']),
  label: z.string().min(1),
  method: z.enum(['classical-floor', 'intermittent', 'tsfm', 'rule-based+overlay']),
  defaultHorizon: z.number().int().min(1),
  targetCoverage: z.number().gt(0).lt(1),
  highRisk: z.boolean(),
  monetary: z.boolean(),
}) as unknown as z.ZodType<ForecastTargetDef>;
