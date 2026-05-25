/**
 * Autonomy policy service — Drizzle/Postgres adapter that reads per-
 * tenant autonomy policies from migration 0080 (`autonomy_policies`).
 *
 * Adapts to the kernel-agency `AutonomyPolicyPort` shape. The policy is
 * read on every executor decision; the service falls back to the
 * default-allow-low-stakes policy whenever:
 *   - the row is missing for the tenant,
 *   - the master `autonomous_mode_enabled` switch is off,
 *   - the policy_json's per-action / per-stakes block is missing or
 *     malformed,
 *   - the DB query throws (logged + degraded — the executor must keep
 *     running even if this table is unavailable).
 *
 * The on-disk policy_json is intentionally permissive in shape (it is
 * the head-of-department's free-form configuration). We narrow it
 * here through Zod-light hand validation so a malformed JSON blob can
 * never crash the executor — it just falls back to the default policy.
 */
import { eq } from 'drizzle-orm';
import { autonomyPolicies } from '../schemas/autonomy.schema.js';
import type { DatabaseClient } from '../client.js';
import { logger } from '../logger.js';


// ─────────────────────────────────────────────────────────────────────
// Public types — duck-typed against the kernel-agency port shape so
// this package does NOT compile-time-depend on @borjie/central-
// intelligence (which would create a cycle).
// ─────────────────────────────────────────────────────────────────────

export type AutonomyStakes = 'low' | 'medium' | 'high' | 'critical';

export interface AutonomyPolicyDecideArgs {
  readonly tenantId: string;
  readonly userId: string;
  readonly toolName: string;
  readonly stakes: AutonomyStakes;
}

export interface AutonomyPolicyDecision {
  readonly authorized: boolean;
  readonly requiresApproval: boolean;
  readonly reason: string;
}

export interface PgAutonomyPolicyService {
  decide(args: AutonomyPolicyDecideArgs): Promise<AutonomyPolicyDecision>;
}

// ─────────────────────────────────────────────────────────────────────
// Default-allow-low-stakes fallback. Used inside the service whenever
// a row is missing / disabled / malformed — and exported so callers
// can compose the same fallback at the kernel layer.
// ─────────────────────────────────────────────────────────────────────

export function defaultAllowLowStakes(
  args: AutonomyPolicyDecideArgs,
  reasonSuffix: string,
): AutonomyPolicyDecision {
  if (args.stakes === 'low') {
    return {
      authorized: true,
      requiresApproval: false,
      reason: `low-stakes default-allow (${reasonSuffix})`,
    };
  }
  return {
    authorized: true,
    requiresApproval: true,
    reason: `${args.stakes}-stakes requires four-eye approval (${reasonSuffix})`,
  };
}

// ─────────────────────────────────────────────────────────────────────
// policy_json shape — best-effort schema. Operators may shape this
// JSON freely; we only read the subset we understand.
//
// {
//   "actions": {
//     "rent.send-reminder": {
//       "authorized": true,
//       "requiresApproval": false
//     },
//     ...
//   },
//   "stakes": {
//     "low":      { "authorized": true,  "requiresApproval": false },
//     "medium":   { "authorized": true,  "requiresApproval": true  },
//     "high":     { "authorized": true,  "requiresApproval": true  },
//     "critical": { "authorized": false, "requiresApproval": true  }
//   }
// }
//
// Action match wins over stakes match. If neither matches, fall back
// to the default-allow-low-stakes path with reason='no-action-or-
// stakes-rule'.
// ─────────────────────────────────────────────────────────────────────

interface PolicyRule {
  readonly authorized: boolean;
  readonly requiresApproval: boolean;
}

function readRule(value: unknown): PolicyRule | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (typeof v.authorized !== 'boolean') return null;
  if (typeof v.requiresApproval !== 'boolean') return null;
  return {
    authorized: v.authorized,
    requiresApproval: v.requiresApproval,
  };
}

function readActionRule(
  policyJson: unknown,
  toolName: string,
): PolicyRule | null {
  if (!policyJson || typeof policyJson !== 'object') return null;
  const root = policyJson as Record<string, unknown>;
  const actions = root.actions;
  if (!actions || typeof actions !== 'object') return null;
  const block = (actions as Record<string, unknown>)[toolName];
  return readRule(block);
}

function readStakesRule(
  policyJson: unknown,
  stakes: AutonomyStakes,
): PolicyRule | null {
  if (!policyJson || typeof policyJson !== 'object') return null;
  const root = policyJson as Record<string, unknown>;
  const stakesBlock = root.stakes;
  if (!stakesBlock || typeof stakesBlock !== 'object') return null;
  const block = (stakesBlock as Record<string, unknown>)[stakes];
  return readRule(block);
}

// ─────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────

export function createPgAutonomyPolicyService(
  db: DatabaseClient,
): PgAutonomyPolicyService {
  return {
    async decide(args): Promise<AutonomyPolicyDecision> {
      if (!args.tenantId) {
        return defaultAllowLowStakes(args, 'no-tenant');
      }

      let row:
        | {
            autonomousModeEnabled: boolean;
            policyJson: unknown;
          }
        | undefined;
      try {
        const rows = await db
          .select({
            autonomousModeEnabled: autonomyPolicies.autonomousModeEnabled,
            policyJson: autonomyPolicies.policyJson,
          })
          .from(autonomyPolicies)
          .where(eq(autonomyPolicies.tenantId, args.tenantId))
          .limit(1);
        row = Array.isArray(rows) ? rows[0] : undefined;
      } catch (error) {
        logger.error('autonomy-policy.decide failed', { error: error });
        return defaultAllowLowStakes(args, 'db-error');
      }

      if (!row) {
        return defaultAllowLowStakes(args, 'no-row');
      }
      if (!row.autonomousModeEnabled) {
        return defaultAllowLowStakes(args, 'autonomous-mode-disabled');
      }

      const actionRule = readActionRule(row.policyJson, args.toolName);
      if (actionRule) {
        return {
          authorized: actionRule.authorized,
          requiresApproval: actionRule.requiresApproval,
          reason: `policy-action-rule: ${args.toolName}`,
        };
      }

      const stakesRule = readStakesRule(row.policyJson, args.stakes);
      if (stakesRule) {
        return {
          authorized: stakesRule.authorized,
          requiresApproval: stakesRule.requiresApproval,
          reason: `policy-stakes-rule: ${args.stakes}`,
        };
      }

      return defaultAllowLowStakes(args, 'no-action-or-stakes-rule');
    },
  };
}
