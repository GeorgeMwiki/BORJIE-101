/**
 * Policy Gate — Assertions
 *
 * Runtime guards used at every API route + MD tool call-site:
 *
 *   - `assertTierPolicy(role, action)` — discriminated-result variant;
 *     never throws. The hot-path check.
 *   - `requireTierPolicy(role, action)` — throwing variant for code
 *     paths where a denial is exceptional.
 *   - `assertTierPolicyAsync(...)` — full reason-based resolver with
 *     optional LLM judge. Use from tools that can afford an extra
 *     round-trip.
 *   - `assertApproved(approvalId, ...)` — checks that a four-eye
 *     approval record has reached its quorum and is still valid.
 *     Independent of the tier check; both must pass before the side
 *     effect runs.
 *
 * Constitutional AI v2 — when the literal allow-list misses,
 * `assertTierPolicy` consults the synchronous string-similarity branch
 * of the reason-based resolver before refusing. Surfaces that don't
 * want generalisation (money-movement, payouts, sovereign mutations)
 * are forced to literal-only via {@link isHighRiskLiteralOnly}, regardless
 * of the caller's `skipGeneralization` flag.
 *
 * @module policy-gate/assertions
 */

import { isHighRiskLiteralOnly } from './high-risk-literal-only.js';
import {
  isAllowedVerdict,
  resolveActionVerdict,
  scoreRule,
  type MdRole,
  type PolicyRule,
  type PrincipleJudge,
  type ResolveResult,
} from './tier-policy-resolver.js';

// ════════════════════════════════════════════════════════════════════
// Result shape — discriminated so callers can branch without throwing.
// ════════════════════════════════════════════════════════════════════

export type TierAssertionResult =
  | {
      readonly ok: true;
      /** True when the allow was inferred from a matching principle
       *  rather than from an exact action match. */
      readonly reasonGeneralized?: boolean;
      /** Stable principle id, when generalised. */
      readonly principle?: string;
    }
  | {
      readonly ok: false;
      readonly reason: string;
      readonly code: 'role_forbidden';
      /** True when the deny was emitted by the reason resolver rather
       *  than the literal allow-list. */
      readonly reasonGeneralized?: boolean;
    };

// ════════════════════════════════════════════════════════════════════
// Allow-list view onto the principled rule set.
//
// Callers either pass a flat `allowed: ReadonlyArray<string>` (legacy
// allow-list) OR the full `rules: ReadonlyArray<PolicyRule>`. The
// allow-list is derived from the rule set when not supplied.
// ════════════════════════════════════════════════════════════════════

export interface RolePolicy {
  readonly role: MdRole;
  /** Stable description for audit + UI. */
  readonly description?: string;
  /** The literal allow-list — every action that this role may invoke
   *  without consulting the reason resolver. Derived from `rules`
   *  when not supplied. */
  readonly allowed?: ReadonlyArray<string>;
  /** Constitutional AI v2 principled rules. The reason resolver scores
   *  against this set when the literal allow-list misses. */
  readonly rules: ReadonlyArray<PolicyRule>;
}

function derivedAllowed(policy: RolePolicy): ReadonlyArray<string> {
  if (policy.allowed) return policy.allowed;
  const out: string[] = [];
  for (const rule of policy.rules) {
    if (rule.verdict !== 'deny') out.push(rule.action);
  }
  return out;
}

// ════════════════════════════════════════════════════════════════════
// Synchronous generalisation helper (no LLM judge — fast path)
// ════════════════════════════════════════════════════════════════════

const SYNC_AUTO_MATCH_THRESHOLD = 0.7;

interface SyncGeneralizationResult {
  readonly allowed: boolean;
  readonly principle?: string;
  readonly ruleId?: string;
  readonly score: number;
  readonly reason: string;
}

function trySyncReasonGeneralization(
  policy: RolePolicy,
  action: string,
): SyncGeneralizationResult {
  const rules = policy.rules;
  if (rules.length === 0) {
    return {
      allowed: false,
      score: 0,
      reason: `role '${policy.role}' has no principled rules to generalise from`,
    };
  }
  let best: { rule: PolicyRule; score: number } | null = null;
  for (const rule of rules) {
    const score = scoreRule(action, rule);
    if (!best || score > best.score) best = { rule, score };
  }
  if (!best || best.score < SYNC_AUTO_MATCH_THRESHOLD) {
    if (!best) {
      return { allowed: false, score: 0, reason: 'no principle to consider' };
    }
    return {
      allowed: false,
      score: best.score,
      principle: best.rule.principle,
      ruleId: best.rule.id,
      reason: `best principle '${best.rule.principle}' similarity ${best.score.toFixed(2)} < ${SYNC_AUTO_MATCH_THRESHOLD}`,
    };
  }
  return {
    allowed: best.rule.verdict !== 'deny',
    principle: best.rule.principle,
    ruleId: best.rule.id,
    score: best.score,
    reason: `principle '${best.rule.principle}' covers '${action}' (similarity ${best.score.toFixed(2)}, rule ${best.rule.id})`,
  };
}

// ════════════════════════════════════════════════════════════════════
// Public API — tier policy
// ════════════════════════════════════════════════════════════════════

export interface AssertTierPolicyOptions {
  /** Opt out of reason-based generalisation. High-risk surfaces should
   *  set this to true so a missing literal rule is a hard deny.
   *
   *  NOTE: actions whose prefix appears in
   *  `HIGH_RISK_LITERAL_ONLY_PREFIXES` (money-movement, sovereign
   *  mutations, payouts, killswitches, key rotations, policy rollouts,
   *  model pins, tenant-suspensions) are ALWAYS treated as literal-only
   *  regardless of this flag. Setting it to `false` cannot widen those
   *  surfaces — the SECURITY DEFAULT wins. */
  readonly skipGeneralization?: boolean;
}

/**
 * Check whether `role` is permitted to attempt `action`. Never throws.
 *
 * Pipeline:
 *   1. Literal allow-list lookup — exact match returns `ok: true`.
 *   2. If the action falls under the high-risk literal-only opt-out
 *      list OR the caller passed `skipGeneralization: true`, the
 *      literal miss is the final word and the result is `ok: false`.
 *   3. Otherwise, the synchronous reason-based generalisation branch
 *      runs against `policy.rules`. A similarity ≥ 0.7 hit on a rule
 *      whose verdict is not `deny` yields `ok: true` with
 *      `reasonGeneralized: true`.
 *   4. No match → `ok: false`.
 */
export function assertTierPolicy(
  policy: RolePolicy,
  action: string,
  options?: AssertTierPolicyOptions,
): TierAssertionResult {
  // Defensive guard: an unknown role (only possible via runtime type
  // assertion) must be denied, never crash.
  if (!policy || !Array.isArray(policy.rules)) {
    return {
      ok: false,
      code: 'role_forbidden',
      reason: `unknown role policy — no rules registered (forbidden by default)`,
    };
  }

  const allowed = derivedAllowed(policy);
  if (allowed.includes(action)) {
    return { ok: true };
  }

  // SECURITY DEFAULT: high-risk action prefixes (money-movement,
  // sovereign mutations, payouts, killswitches, key rotations, policy
  // rollouts, model pins, tenant-suspensions) are ALWAYS literal-only.
  const forceLiteralOnly =
    isHighRiskLiteralOnly(action) || options?.skipGeneralization === true;

  if (forceLiteralOnly) {
    return {
      ok: false,
      code: 'role_forbidden',
      reason: `role '${policy.role}' may not perform '${action}' (literal-only check)`,
    };
  }

  const general = trySyncReasonGeneralization(policy, action);
  if (general.allowed) {
    return {
      ok: true,
      reasonGeneralized: true,
      ...(general.principle !== undefined && { principle: general.principle }),
    };
  }

  return {
    ok: false,
    code: 'role_forbidden',
    reason: `role '${policy.role}' may not perform '${action}' (${general.reason})`,
    reasonGeneralized: true,
  };
}

/**
 * Throwing variant for hot paths where a denial is exceptional.
 *
 * @throws Error when the role may not perform the action.
 */
export function requireTierPolicy(
  policy: RolePolicy,
  action: string,
  options?: AssertTierPolicyOptions,
): void {
  const result = assertTierPolicy(policy, action, options);
  if (!result.ok) {
    throw new Error(`TierPolicyViolation: ${result.reason}`);
  }
}

/**
 * Async variant that consults the full reason-based resolver including
 * the optional LLM judge. Use this from MD tools that can afford an
 * extra round-trip when the synchronous similarity check is in the
 * grey zone.
 */
export async function assertTierPolicyAsync(args: {
  readonly policy: RolePolicy;
  readonly action: string;
  readonly context?: Record<string, unknown>;
  readonly judge?: PrincipleJudge;
  readonly skipGeneralization?: boolean;
}): Promise<{
  readonly ok: boolean;
  readonly result: ResolveResult | null;
  readonly reason: string;
}> {
  const allowed = derivedAllowed(args.policy);
  if (allowed.includes(args.action)) {
    return { ok: true, result: null, reason: 'literal allow-list match' };
  }

  const forceLiteralOnly =
    isHighRiskLiteralOnly(args.action) || args.skipGeneralization === true;
  if (forceLiteralOnly) {
    return {
      ok: false,
      result: null,
      reason: `role '${args.policy.role}' may not perform '${args.action}' (literal-only check)`,
    };
  }

  const result = await resolveActionVerdict({
    role: args.policy.role,
    action: args.action,
    rules: args.policy.rules,
    ...(args.context !== undefined && { context: args.context }),
    ...(args.judge !== undefined && { judge: args.judge }),
  });
  return {
    ok: isAllowedVerdict(result.verdict),
    result,
    reason: result.reasoning,
  };
}

// ════════════════════════════════════════════════════════════════════
// Public API — four-eye approval assertion
// ════════════════════════════════════════════════════════════════════

/**
 * The shape of an approval record `assertApproved` will accept. Matches
 * the Borjie `four-eye-approval.ts` lifecycle states; kept as a
 * narrow interface here so this module does not take a hard import
 * dependency on the kernel.
 */
export interface PolicyGateApprovalRecord {
  readonly id: string;
  readonly status:
    | 'pending'
    | 'one-eye'
    | 'approved'
    | 'rejected'
    | 'expired'
    | 'recalled';
  /** What the approval is for. The caller passes the expected action
   *  and we cross-check it. */
  readonly toolName: string;
  /** Optional binding to a specific tenant — when supplied, the
   *  approval is invalid for any other tenant. */
  readonly tenantId?: string | null;
  /** ISO timestamp — the approval must not have expired. */
  readonly expiresAt?: Date | string;
  /** Set when the approval has been one-shot consumed already. */
  readonly executed?: boolean;
}

export interface PolicyGateApprovalLookup {
  findById(approvalId: string): Promise<PolicyGateApprovalRecord | null>;
}

export type PolicyGateApprovalResult =
  | { readonly ok: true; readonly record: PolicyGateApprovalRecord }
  | {
      readonly ok: false;
      readonly reason: string;
      readonly code:
        | 'approval_not_found'
        | 'approval_not_quorum'
        | 'approval_expired'
        | 'approval_consumed'
        | 'approval_tool_mismatch'
        | 'approval_tenant_mismatch';
    };

function isApprovalExpired(record: PolicyGateApprovalRecord, now: Date): boolean {
  if (!record.expiresAt) return false;
  const expires =
    record.expiresAt instanceof Date
      ? record.expiresAt
      : new Date(record.expiresAt);
  if (Number.isNaN(expires.getTime())) return false;
  return expires.getTime() <= now.getTime();
}

/**
 * Assert that a four-eye approval record:
 *   1. exists
 *   2. has reached `status === 'approved'` (quorum met)
 *   3. has not been one-shot consumed
 *   4. has not expired
 *   5. is for the expected tool/action
 *   6. (if `tenantId` supplied) is bound to the requesting tenant
 *
 * The check is independent of the tier-policy check; both must pass
 * before the side effect runs. Pure function modulo the lookup
 * adapter — the caller supplies the persistence boundary so this
 * module stays unit-testable without DB access.
 */
export async function assertApproved(
  approvalId: string,
  args: {
    readonly lookup: PolicyGateApprovalLookup;
    readonly expectedAction: string;
    readonly tenantId?: string | null;
    readonly now?: Date;
  },
): Promise<PolicyGateApprovalResult> {
  // nosemgrep: missing-tenant-id-arg reason: policy approvals are globally-unique by approvalId; tenant is on the record and the optional `args.tenantId` is cross-checked in the caller.
  const record = await args.lookup.findById(approvalId);
  if (!record) {
    return {
      ok: false,
      code: 'approval_not_found',
      reason: `approval id '${approvalId}' not found`,
    };
  }

  if (record.status !== 'approved') {
    return {
      ok: false,
      code: 'approval_not_quorum',
      reason: `approval '${approvalId}' status='${record.status}' (quorum not met)`,
    };
  }

  if (record.executed === true) {
    return {
      ok: false,
      code: 'approval_consumed',
      reason: `approval '${approvalId}' has already been consumed`,
    };
  }

  const now = args.now ?? new Date();
  if (isApprovalExpired(record, now)) {
    return {
      ok: false,
      code: 'approval_expired',
      reason: `approval '${approvalId}' expired before consumption`,
    };
  }

  if (record.toolName !== args.expectedAction) {
    return {
      ok: false,
      code: 'approval_tool_mismatch',
      reason: `approval '${approvalId}' is for '${record.toolName}', not '${args.expectedAction}'`,
    };
  }

  if (
    args.tenantId !== undefined &&
    args.tenantId !== null &&
    record.tenantId &&
    record.tenantId !== args.tenantId
  ) {
    return {
      ok: false,
      code: 'approval_tenant_mismatch',
      reason: `approval '${approvalId}' is bound to tenant '${record.tenantId}', not '${args.tenantId}'`,
    };
  }

  return { ok: true, record };
}

// Re-exports for callers that want the resolver's full surface.
export {
  isAllowedVerdict,
  resolveActionVerdict,
  type MdRole,
  type PolicyRule,
  type PolicyVerdict,
  type PrincipleJudge,
  type ResolveResult,
  type ResolvedVerdict,
} from './tier-policy-resolver.js';
