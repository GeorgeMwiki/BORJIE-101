/**
 * Power Tools — agent meta-capabilities.
 *
 * Power tools sit BETWEEN regular HQ tools (deterministic, identity-scoped
 * actions the kernel exposes to its LLM loop) and sovereign-write actions
 * (mutations gated by four-eye approval). They are the agent's own
 * workflow-management vocabulary:
 *
 *   - escalate this turn to a higher tier when permission gap detected
 *   - chain N sub-MD calls into one transactional unit
 *   - schedule a deferred kernel call (Inngest or plain setTimeout)
 *   - run a small JS snippet in a frozen sandbox
 *   - ask for an anonymised cross-tenant aggregate (PLATFORM_SOVEREIGN-only)
 *   - rewrite the persona's own prompt for the next iteration (Reflexion)
 *   - emit a progress event onto a shared blackboard channel
 *
 * Each power-tool definition carries:
 *   - the minimum tier required to invoke it
 *   - whether the four-eye approval gate must fire BEFORE execution
 *   - an audit-trail contract (sovereign_action_ledger row or audit_events row)
 *   - a Zod schema for the args + a deterministic execute function
 *
 * The kernel composes a `PowerToolRegistry` at boot, and the orchestrator
 * looks up `power_tool.<id>` calls against it the same way it does for the
 * HQ-tier `HqToolSpec` registry.
 *
 * @module kernel/power-tools/types
 */

import type { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────
// Tier taxonomy — mirrors Borjie's persona ladder.
// ─────────────────────────────────────────────────────────────────────

/**
 * Power-tool tier ordering (low → high blast radius). The values
 * intentionally match the persona ids in `kernel/identity.ts` so the
 * api-gateway can map an authenticated session to a tier without an
 * extra translation table.
 */
export type PowerToolTier =
  | 'tenant-resident'
  | 'owner-advisor'
  | 'estate-manager'
  | 'org-admin'
  | 'platform-sovereign'
  | 'sovereign-admin';

/**
 * Ordered low → high. Useful for `tierRank()`-style comparisons and
 * dashboard rendering.
 */
export const POWER_TOOL_TIERS_ORDERED: ReadonlyArray<PowerToolTier> = Object.freeze([
  'tenant-resident',
  'owner-advisor',
  'estate-manager',
  'org-admin',
  'platform-sovereign',
  'sovereign-admin',
]);

const TIER_RANK: Readonly<Record<PowerToolTier, number>> = Object.freeze({
  'tenant-resident': 0,
  'owner-advisor': 1,
  'estate-manager': 2,
  'org-admin': 3,
  'platform-sovereign': 4,
  'sovereign-admin': 5,
});

/** Compare two tiers. `-1` / `0` / `1` for lower / equal / higher. */
export function comparePowerToolTier(a: PowerToolTier, b: PowerToolTier): -1 | 0 | 1 {
  const ra = TIER_RANK[a];
  const rb = TIER_RANK[b];
  if (ra < rb) return -1;
  if (ra > rb) return 1;
  return 0;
}

/** True when caller `actual` is at OR above the required tier. */
export function meetsTier(actual: PowerToolTier, required: PowerToolTier): boolean {
  return TIER_RANK[actual] >= TIER_RANK[required];
}

/** Numeric rank for a tier, for ordering operations. */
export function powerToolTierRank(tier: PowerToolTier): number {
  return TIER_RANK[tier];
}

// ─────────────────────────────────────────────────────────────────────
// Audit trail destinations — the ledger sink a power-tool emits to.
// ─────────────────────────────────────────────────────────────────────

/**
 * Where a power-tool persists its audit row.
 *
 *   - 'none'                    pure thought-loop tool, no persistence
 *   - 'audit-events'            ordinary `audit_events` row (most tools)
 *   - 'sovereign-action-ledger' tamper-resistant ledger (cross-tenant,
 *                                self-modification, anything that lands
 *                                a row the regulator would want signed)
 */
export type PowerToolAuditDestination =
  | 'none'
  | 'audit-events'
  | 'sovereign-action-ledger';

/** A single audit row a power-tool's execute emits. The api-gateway
 *  routes the row to the correct sink based on `destination`. */
export interface PowerToolAuditRow {
  readonly destination: PowerToolAuditDestination;
  readonly toolId: string;
  readonly tier: PowerToolTier;
  readonly callerId: string;
  readonly tenantId: string | null;
  readonly inputJson: string;
  readonly outputJson: string | null;
  readonly outcome: 'ok' | 'refused' | 'failed';
  readonly errorMessage: string | null;
  readonly approvalRecordId: string | null;
  readonly at: string;
}

/** Sink the registry calls after every execute. The api-gateway wires
 *  the Drizzle adapter; tests inject an in-memory recorder. */
export interface PowerToolAuditSink {
  record(row: PowerToolAuditRow): Promise<void>;
}

// ─────────────────────────────────────────────────────────────────────
// Execution context — what the kernel passes to every execute.
// ─────────────────────────────────────────────────────────────────────

/**
 * The execution context threaded into every power-tool call. The kernel
 * NEVER trusts identity from the LLM input — caller + tier come from
 * the authenticated session resolved at the api-gateway boundary.
 */
export interface PowerToolContext {
  readonly callerId: string;
  readonly tier: PowerToolTier;
  /** Tenant scope of the call. `null` for platform-level invocations. */
  readonly tenantId: string | null;
  /** The conversation / thought thread this call belongs to. */
  readonly threadId: string;
  /**
   * Approval-record id, threaded through when the four-eye gate fired
   * BEFORE the orchestrator dispatched the call. `null` otherwise.
   */
  readonly approvalRecordId: string | null;
  /** Optional audit sink. When provided the registry persists a row. */
  readonly auditSink: PowerToolAuditSink | null;
  /** Injectable clock — tests pin time. */
  readonly clock: () => Date;
}

// ─────────────────────────────────────────────────────────────────────
// PowerTool — the spec a single power-tool file exports.
// ─────────────────────────────────────────────────────────────────────

/**
 * Discriminated outcome a power-tool's execute returns. The registry
 * normalises this into the audit row + the kernel-step outcome.
 */
export type PowerToolResult<O> =
  | { readonly kind: 'ok'; readonly output: O }
  | { readonly kind: 'refused'; readonly reasonCode: PowerToolRefusalReason; readonly message: string }
  | { readonly kind: 'failed'; readonly message: string };

/**
 * Why a power-tool refused to run. Separate from validation failures —
 * the registry catches those before execute is called.
 */
export type PowerToolRefusalReason =
  | 'TIER_TOO_LOW'           // caller tier below requiredTier
  | 'APPROVAL_MISSING'       // requiresApproval=true but no approvalRecordId
  | 'KILLSWITCH_HALTED'      // global killswitch refuses all power-tools
  | 'COHORT_TOO_SMALL'       // k-anonymity floor not met (cross-tenant)
  | 'TRANSACTIONAL_ROLLBACK' // compose chain rolled back mid-flight
  | 'OUT_OF_SCOPE'           // tenant mismatch / scope refused
  | 'NOT_IMPLEMENTED';       // backing adapter not yet wired

/**
 * The spec each power-tool file exports. The registry stores these and
 * exposes them to the orchestrator's tool-loop.
 */
export interface PowerTool<I = unknown, O = unknown> {
  /** Stable id, written as `power_tool.<id>`. snake_case. */
  readonly id: string;
  /** Short human-readable name surfaced in inventories + dashboards. */
  readonly name: string;
  /** One-paragraph description the LLM reads when deciding to invoke. */
  readonly description: string;
  /** Minimum tier needed to invoke this tool. */
  readonly requiredTier: PowerToolTier;
  /**
   * When true, the four-eye approval gate MUST have fired before
   * execute is called. The orchestrator detects this and routes the
   * call through `createApprovalGate.propose()` first; only when the
   * gate flips to `approved` does the registry dispatch.
   */
  readonly requiresApproval: boolean;
  /** Audit-trail destination. The registry routes the post-execute row. */
  readonly auditDestination: PowerToolAuditDestination;
  /** Zod schema validating the LLM-supplied args before execute fires. */
  readonly schema: z.ZodType<I>;
  /** Deterministic execute. Pure when possible; persistence via deps. */
  execute(ctx: PowerToolContext, args: I): Promise<PowerToolResult<O>>;
}

/** Convenience alias for the registry-side erased shape. */
export type AnyPowerTool = PowerTool<unknown, unknown>;
