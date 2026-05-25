/**
 * Risk-tier taxonomy for HQ-tier BrainTools (Central Command write
 * vocabulary).
 *
 * Per `.planning/central-command/00-architecture.md` HIL safety
 * primitive #2 ("Risk tiers"), every `platform.*` tool the admin
 * portal exposes is assigned a tier that determines:
 *
 *   - whether four-eye approval is mandatory before the executor runs
 *   - whether the call must be persisted to the sovereign-action
 *     ledger (regulator-grade tamper-resistant audit)
 *   - which OTel attributes are stamped on the emitted span
 *   - whether the cost-ceiling gate applies
 *
 * The tiers, low → high blast radius:
 *
 *   1. 'read'          — pure reads (list_tenants, system_health,
 *                        read_feature_flag). No approval, no ledger.
 *   2. 'mutate'        — reversible writes (create_tenant, create_user,
 *                        set_feature_flag, run_consolidation_tick).
 *                        No approval; audit-trail only.
 *   3. 'destroy'       — non-reversible-by-default operations
 *                        (set_killswitch). 4-eye + sovereign-ledger.
 *   4. 'billing'       — money-moving operations (adjust_invoice).
 *                        4-eye + cost-ceiling gate + sovereign-ledger.
 *   5. 'external-comm' — pushes that reach end users (announcements,
 *                        SMS blasts). 4-eye + content review + ledger.
 *
 * Identity-scoped retrieval is enforced at each tool's executor — the
 * caller's scopes are matched against the target tenant before the
 * call runs. Identity is the boundary, not the prompt.
 */

import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────
// Tier taxonomy
// ─────────────────────────────────────────────────────────────────────

export type RiskTier = 'read' | 'mutate' | 'destroy' | 'billing' | 'external-comm';

/**
 * Ordered list of tiers, low → high blast radius. Useful for
 * dashboards and policy-engine comparisons.
 */
export const RISK_TIERS_ORDERED: ReadonlyArray<RiskTier> = Object.freeze([
  'read',
  'mutate',
  'destroy',
  'billing',
  'external-comm',
]);

const TIER_RANK: Readonly<Record<RiskTier, number>> = Object.freeze({
  read: 0,
  mutate: 1,
  destroy: 2,
  billing: 3,
  'external-comm': 4,
});

/**
 * Compare two tiers. Returns -1 / 0 / 1 — `a` strictly lower than `b`,
 * equal, or strictly higher.
 */
export function compareRiskTier(a: RiskTier, b: RiskTier): -1 | 0 | 1 {
  const ra = TIER_RANK[a];
  const rb = TIER_RANK[b];
  if (ra < rb) return -1;
  if (ra > rb) return 1;
  return 0;
}

/**
 * Tiers that MUST persist to the sovereign-action ledger (tamper-
 * resistant hash-chain). Reads and ordinary mutates rely on the
 * deterministic tool-audit trail; destroy / billing / external-comm
 * additionally land in the sovereign ledger.
 */
export const SOVEREIGN_LEDGER_TIERS: ReadonlySet<RiskTier> = Object.freeze(
  new Set<RiskTier>(['destroy', 'billing', 'external-comm']),
);

/**
 * True when a call at this tier must be hash-chained into the
 * sovereign-action ledger in addition to the standard audit sink.
 */
export function isSovereignTier(tier: RiskTier): boolean {
  return SOVEREIGN_LEDGER_TIERS.has(tier);
}

/**
 * Whether the cost-ceiling gate applies. Today only `billing` —
 * `external-comm` will adopt this once message-cost telemetry is wired.
 */
export function requiresCostCeiling(tier: RiskTier): boolean {
  return tier === 'billing';
}

// ─────────────────────────────────────────────────────────────────────
// HqToolContext — passed to every executor
// ─────────────────────────────────────────────────────────────────────

/**
 * Caller scopes — RBAC primitives. The list MUST include every scope
 * the caller's authenticated session was granted (e.g.
 * `'platform:admin'`, `'tenant:abc-123:owner'`). Tools that target a
 * tenant must verify the appropriate `tenant:<id>:*` scope is present
 * OR the caller carries a global `'platform:*'` scope.
 */
export interface HqCallerScopes {
  readonly callerId: string;
  readonly scopes: ReadonlyArray<string>;
}

/**
 * Structural OTel-span port. The api-gateway wires a real OTel tracer;
 * tests inject an in-memory recorder. The duck-typed shape sidesteps a
 * hard import of `@opentelemetry/api` from the kernel package.
 */
export interface HqOtelSpanRecorder {
  recordSpan(args: {
    readonly name: string;
    readonly attributes: Readonly<Record<string, string | number | boolean | null>>;
    readonly durationMs: number;
    readonly status: 'ok' | 'error';
    readonly errorMessage?: string | null;
  }): void;
}

/**
 * Sovereign-action ledger port. Tools at destroy / billing / external-
 * comm tier MUST emit a row here in addition to the standard tool
 * audit sink. The api-gateway wires the Drizzle adapter; tests inject
 * the in-memory sink.
 */
export interface HqSovereignLedgerSink {
  recordSovereignAction(row: {
    readonly toolName: string;
    readonly riskTier: RiskTier;
    readonly callerId: string;
    readonly tenantId: string | null;
    readonly inputJson: string;
    readonly outputJson: string | null;
    readonly approvalRequired: boolean;
    readonly approvalRecordId: string | null;
    readonly costEstimateUsd: number | null;
    readonly at: string;
  }): Promise<void>;
}

/**
 * Per-call context the registry composes and passes to each
 * `HqToolSpec.execute`. Tools NEVER read identity from the prompt;
 * they only see what the gateway authenticated upstream.
 */
export interface HqToolContext {
  readonly caller: HqCallerScopes;
  /**
   * When this tool was approved via the four-eye gate, the approval-
   * record id is threaded through here so the ledger row joins back
   * to the approval chain. `null` for read / mutate tiers and for
   * destroy/billing/external-comm calls that bypassed the gate
   * (only test rigs do this).
   */
  readonly approvalRecordId: string | null;
  readonly otel: HqOtelSpanRecorder | null;
  readonly sovereignLedger: HqSovereignLedgerSink | null;
  readonly clock: () => Date;
}

// ─────────────────────────────────────────────────────────────────────
// HqToolSpec — what each platform.* file exports
// ─────────────────────────────────────────────────────────────────────

/**
 * Discriminated execute outcome. Tools never return raw values — they
 * return a result tag so the registry layer can route success / refusal
 * / error consistently and so the OTel span carries the right status.
 */
export type HqToolExecutionResult<O> =
  | { readonly kind: 'ok'; readonly output: O }
  | { readonly kind: 'refused'; readonly reasonCode: HqRefusalReasonCode; readonly message: string }
  | { readonly kind: 'failed'; readonly message: string };

/**
 * Refusal reason codes — surfaced when an HQ tool DECLINES to run
 * (separate from validation failures, which the registry handles).
 * Dashboards group refusals by code so ops can spot policy issues.
 */
export type HqRefusalReasonCode =
  | 'OUT_OF_SCOPE'           // caller lacks the required RBAC scope for the target
  | 'TENANT_NOT_FOUND'       // target tenant does not exist
  | 'INVARIANT_VIOLATION'    // would breach a domain invariant (e.g. last admin)
  | 'COST_CEILING_EXCEEDED'  // billing-tier cost over the configured ceiling
  | 'ALREADY_APPLIED'        // idempotency — operation already complete
  | 'DOMAIN_LIMIT_EXCEEDED'  // e.g. too many feature-flag flips per hour
  | 'NOT_IMPLEMENTED';       // executor backing service not yet wired

/**
 * Tool spec — the contract every `platform.*.ts` file exports.
 *
 * The registry wraps `execute` with input/output validation, audit-sink
 * persistence, OTel span emission, and sovereign-ledger persistence
 * for destroy/billing/external-comm tiers. Tools should focus on the
 * pure business logic of the call.
 */
export interface HqToolSpec<I = unknown, O = unknown> {
  /** Tool name. MUST start with `platform.` */
  readonly name: `platform.${string}`;
  readonly riskTier: RiskTier;
  readonly description: string;
  readonly inputSchema: z.ZodType<I>;
  readonly outputSchema: z.ZodType<O>;
  /**
   * RBAC scopes required to invoke this tool AT ALL. Tools then do
   * the per-target check inside `execute` (e.g. `platform.list_users`
   * with a `tenantId` filter requires the caller carry a scope on that
   * tenant).
   */
  readonly requiredScopes: ReadonlyArray<string>;
  /** When true, the gateway routes the call through the four-eye gate. */
  readonly approvalRequired: boolean;
  /** Optional pre-call USD cost estimate used by the cost-ceiling gate. */
  readonly costEstimateUsd?: number;
  /**
   * Optional rollback handler. MANDATORY for mutate / destroy /
   * billing tools — the registry's seed function throws at boot if a
   * tier in that set omits this. external-comm uses a "recall" or
   * "send retraction" pattern instead.
   */
  readonly rollback?: (output: O, ctx: HqToolContext) => Promise<void>;
  execute(args: I, ctx: HqToolContext): Promise<HqToolExecutionResult<O>>;
}

// ─────────────────────────────────────────────────────────────────────
// Scope helpers — identity is the boundary
// ─────────────────────────────────────────────────────────────────────

/**
 * Returns true when the caller carries at least one of `required`. A
 * scope match supports wildcard `platform:*` and tenant-prefixed
 * scopes like `tenant:<id>:*`.
 */
export function callerHasAnyScope(
  caller: HqCallerScopes,
  required: ReadonlyArray<string>,
): boolean {
  if (required.length === 0) return true;
  for (const req of required) {
    for (const have of caller.scopes) {
      if (scopeMatches(have, req)) return true;
    }
  }
  return false;
}

/**
 * Returns true when the caller carries ALL of `required`. Used by
 * destroy / billing tools that demand multiple authorisations
 * (e.g. both `platform:admin` and `platform:billing:write`).
 */
export function callerHasAllScopes(
  caller: HqCallerScopes,
  required: ReadonlyArray<string>,
): boolean {
  if (required.length === 0) return true;
  for (const req of required) {
    let satisfied = false;
    for (const have of caller.scopes) {
      if (scopeMatches(have, req)) {
        satisfied = true;
        break;
      }
    }
    if (!satisfied) return false;
  }
  return true;
}

/**
 * Returns true when `have` covers `required`. Supports trailing `*`
 * wildcards (so `platform:*` covers `platform:tenants:write`).
 */
export function scopeMatches(have: string, required: string): boolean {
  if (have === required) return true;
  if (!have.endsWith(':*')) return false;
  const prefix = have.slice(0, -1); // drop trailing '*'
  return required.startsWith(prefix);
}

/**
 * Returns true when the caller can reach the given tenant — either
 * carries a platform-wide scope or a tenant-prefixed scope on this
 * tenant.
 */
export function callerCanReachTenant(
  caller: HqCallerScopes,
  tenantId: string | null,
): boolean {
  for (const have of caller.scopes) {
    if (have === 'platform:*' || have.startsWith('platform:admin')) return true;
    if (have.startsWith('platform:')) {
      const tail = have.slice('platform:'.length);
      if (tail.endsWith(':*') || tail === '*') return true;
    }
  }
  if (!tenantId) return false; // platform-scoped target needed but caller lacks platform-wide scope
  const tenantPrefix = `tenant:${tenantId}`;
  for (const have of caller.scopes) {
    if (have === tenantPrefix || have.startsWith(`${tenantPrefix}:`)) return true;
  }
  return false;
}

// ─────────────────────────────────────────────────────────────────────
// Construction-time invariants
// ─────────────────────────────────────────────────────────────────────

/**
 * Asserts a spec is well-formed at registry-seed time. Throws on
 * misuse so the gateway fails to boot rather than silently shipping
 * an un-rollbackable mutate tool.
 */
export function assertHqToolSpecValid<I, O>(spec: HqToolSpec<I, O>): void {
  if (!spec.name.startsWith('platform.')) {
    throw new Error(
      `hq-tool: spec name "${spec.name}" must start with "platform."`,
    );
  }
  if (!RISK_TIERS_ORDERED.includes(spec.riskTier)) {
    throw new Error(
      `hq-tool: spec "${spec.name}" has unknown riskTier "${spec.riskTier}"`,
    );
  }
  const requiresRollback =
    spec.riskTier === 'mutate' ||
    spec.riskTier === 'destroy' ||
    spec.riskTier === 'billing';
  if (requiresRollback && !spec.rollback) {
    throw new Error(
      `hq-tool: spec "${spec.name}" (tier=${spec.riskTier}) MUST define rollback or explicitly throw`,
    );
  }
  if (requiresCostCeiling(spec.riskTier) && spec.costEstimateUsd === undefined) {
    throw new Error(
      `hq-tool: spec "${spec.name}" (tier=billing) MUST declare costEstimateUsd`,
    );
  }
  if (
    (spec.riskTier === 'destroy' ||
      spec.riskTier === 'billing' ||
      spec.riskTier === 'external-comm') &&
    !spec.approvalRequired
  ) {
    throw new Error(
      `hq-tool: spec "${spec.name}" (tier=${spec.riskTier}) MUST require approval`,
    );
  }
}
