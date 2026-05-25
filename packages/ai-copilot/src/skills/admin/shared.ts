/**
 * Shared helpers for admin skills.
 *
 * Admin skills wrap gateway write endpoints so they are reachable via the
 * Mr. Mwikila chat widget. Each skill:
 *   1. Validates input with Zod (schema-first).
 *   2. Checks tenant isolation against the caller's AITenantContext.
 *   3. Routes high-risk actions through a PROPOSED_ACTION gate so the user
 *      must confirm before the side-effect is committed.
 *
 * These helpers are dependency-free; the actual gateway call is wired when
 * the skill is dispatched through the ToolDispatcher + action-accumulator.
 */

import { z } from 'zod';
import type { ToolExecutionContext, ToolExecutionResult } from '../../orchestrator/tool-dispatcher.js';

/**
 * Outcome shape for all admin skills. Mirrors ToolExecutionResult so results
 * can be returned directly from `execute()`.
 */
export interface AdminSkillOutcome<T> {
  readonly ok: boolean;
  readonly data?: T;
  readonly evidenceSummary?: string;
  readonly error?: string;
  /** If true, orchestrator surfaces a PROPOSED_ACTION card to the user. */
  readonly proposed?: boolean;
}

/** Numeric thresholds — above which the action must be user-confirmed. */
export const HIGH_RISK_THRESHOLDS = Object.freeze({
  /** Rent adjustment above this triggers approval (KES). */
  arrearsAdjustmentKes: 20_000,
  /** Bid total above this triggers approval (KES). */
  tenderBidKes: 500_000,
  /** Lease renewal rent-change percentage triggering approval. */
  renewalRentDeltaPct: 0.1,
  /** Broadcast recipient count over which approval is required. */
  broadcastRecipients: 25,
});

/**
 * Verify the target entity belongs to the caller's tenant. Returns an error
 * string if isolation would be violated.
 */
export function assertSameTenant(
  ctx: Pick<ToolExecutionContext, 'tenant'> | undefined,
  targetTenantId: string | undefined
): string | null {
  if (!ctx?.tenant?.tenantId) return 'missing_tenant_context';
  if (targetTenantId && targetTenantId !== ctx.tenant.tenantId) {
    return `cross_tenant_access_denied:${ctx.tenant.tenantId}<>${targetTenantId}`;
  }
  return null;
}

/** Safely parse Zod input and normalise the failure path. */
export interface SafeParseOk<T> {
  readonly ok: true;
  readonly data: T;
  readonly error?: undefined;
}
export interface SafeParseErr {
  readonly ok: false;
  readonly data?: undefined;
  readonly error: string;
}
export type SafeParseResult<T> = SafeParseOk<T> | SafeParseErr;

export function safeParse<S extends z.ZodTypeAny>(
  schema: S,
  params: unknown
): SafeParseResult<z.output<S>> {
  const result = schema.safeParse(params);
  if (result.success) {
    return { ok: true, data: result.data as z.output<S> };
  }
  return {
    ok: false,
    error: result.error.issues.map((i) => `${i.path.join('.')}:${i.message}`).join('; '),
  };
}

/** Canonical "propose then await confirmation" wrapper. */
export function proposed<T>(
  data: T,
  summary: string
): ToolExecutionResult & { proposed: true } {
  return {
    ok: true,
    data: { proposed: true, payload: data },
    evidenceSummary: `PROPOSED: ${summary}`,
    proposed: true,
  } as ToolExecutionResult & { proposed: true };
}

/** Canonical immediate success. */
export function committed<T>(data: T, summary: string): ToolExecutionResult {
  return { ok: true, data, evidenceSummary: summary };
}

/** Canonical failure. */
export function failed(error: string): ToolExecutionResult {
  return { ok: false, error };
}
