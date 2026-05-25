/**
 * Owner-tier tool-spec types.
 *
 * Owner tools mirror the HQ tool spec but constrain `name` to
 * `owner.${string}` and `riskTier` to the non-sovereign tiers (read /
 * mutate). The discriminated `HqToolExecutionResult` is reused so the
 * adapter and audit pipeline stays consistent across families.
 */

import type { z } from 'zod';
import type {
  HqRefusalReasonCode,
  HqToolContext,
  HqToolExecutionResult,
} from '../../risk-tier.js';

/** Owner tools live at a single risk-tier slice — never destroy/bill/comm. */
export type OwnerRiskTier = 'read' | 'mutate';

/** Refusal reason surface — re-exports HQ codes so dashboards group them. */
export type OwnerRefusalReasonCode = HqRefusalReasonCode;

/** Tool-name shape — every owner tool is namespaced `owner.<verb>`. */
export type OwnerToolName = `owner.${string}`;

/**
 * Owner tool spec. Same interface contract as HqToolSpec except:
 *   - `name` is `owner.${string}`
 *   - `riskTier` is `OwnerRiskTier` (no destroy/bill/comm)
 *   - `approvalRequired` is OPTIONAL and defaults to false; the gateway
 *     never routes owner-tier through four-eye approval
 */
export interface OwnerToolSpec<I = unknown, O = unknown> {
  readonly name: OwnerToolName;
  readonly riskTier: OwnerRiskTier;
  readonly description: string;
  readonly inputSchema: z.ZodType<I>;
  readonly outputSchema: z.ZodType<O>;
  readonly requiredScopes: ReadonlyArray<string>;
  readonly approvalRequired: false;
  /**
   * Mandatory for `mutate`-tier owner tools — reverses the side effect
   * if a downstream invariant fails the saga. `read`-tier specs may
   * omit it.
   */
  readonly rollback?: (output: O, ctx: HqToolContext) => Promise<void>;
  execute(args: I, ctx: HqToolContext): Promise<HqToolExecutionResult<O>>;
}
