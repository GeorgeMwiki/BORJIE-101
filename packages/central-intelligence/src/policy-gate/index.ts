/**
 * Policy Gate — Public API
 *
 * Constitution v2 reason-based tier-policy resolver for Borjie's
 * MD (managing director) command surface. Ported from LITFIN's
 * `core/governance/tier-policy` and adapted for Borjie's role
 * hierarchy + the `md:*` action namespace.
 *
 * Import from this file at call-sites; the underlying file layout may
 * change without breakage.
 *
 *   import {
 *     assertTierPolicy,
 *     assertApproved,
 *     HIGH_RISK_LITERAL_ONLY_PREFIXES,
 *     type MdRole,
 *     type RolePolicy,
 *   } from '@borjie/central-intelligence';
 *
 * @module policy-gate
 */

// Resolver — types + reason-based pipeline.
export {
  resolveActionVerdict,
  isAllowedVerdict,
  cosineSimilarity,
  scoreRule,
  ALL_MD_ROLES,
  type MdRole,
  type PolicyRule,
  type PolicyVerdict,
  type PrincipleJudge,
  type ResolveArgs,
  type ResolveResult,
  type ResolvedVerdict,
} from './tier-policy-resolver.js';

// Assertions — synchronous + async tier-policy guards, plus the
// independent four-eye approval check.
export {
  assertTierPolicy,
  assertTierPolicyAsync,
  requireTierPolicy,
  assertApproved,
  type AssertTierPolicyOptions,
  type RolePolicy,
  type TierAssertionResult,
  type PolicyGateApprovalRecord,
  type PolicyGateApprovalLookup,
  type PolicyGateApprovalResult,
} from './assertions.js';

// High-risk opt-out list — exported so operators can audit which
// surfaces are forced to literal-only.
export {
  HIGH_RISK_LITERAL_ONLY_PREFIXES,
  isHighRiskLiteralOnly,
} from './high-risk-literal-only.js';
