/**
 * Approval policy service — Drizzle adapter for `approval_policy_actions`.
 *
 * Reads the declarative four-eye approval policy that gates sovereign-tier
 * kernel tools. The kernel composes this service at the api-gateway sovereign
 * composition root and hands the `resolve` callback to `createApprovalGate` so
 * the gate can require N-of-M role-group signatures per action, rather than
 * the hard-coded "any two distinct approvers" baseline.
 *
 * Resolution order:
 *
 *   1. Per-tenant row with matching action_type (tenantId IS NOT NULL).
 *   2. Platform-default row (tenantId IS NULL).
 *   3. Hard-coded baseline returned from `defaultBaseline()` — equivalent to
 *      "any 2 admins, 24h TTL, no recall, no re-auth, no proposer signature".
 *
 * The resolver NEVER throws. Failed DB reads degrade to the baseline so the
 * kernel can keep proposing actions even when the policy table is unavailable.
 * That is intentional: blocking every proposal on a momentary DB blip would
 * be a self-inflicted DoS against the operator. The kernel still requires the
 * baseline quorum, so the worst-case is "less strict than configured" — never
 * "no approval needed".
 *
 * The service is also a small CRUD adapter so operators can manage policy
 * rows from an admin tool. Writes validate the role-group invariant
 * (sum of minApprovers === minTotalApprovers) and refuse otherwise.
 */
import { randomUUID } from 'crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';
import {

  approvalPolicyActions,
  type ApprovalPolicyRoleGroup,
} from '../schemas/approval-policy.schema.js';
import { logger } from '../logger.js';
import type { DatabaseClient } from '../client.js';

// ─────────────────────────────────────────────────────────────────────
// Public types — duck-typed against the kernel's expected port shape so
// this package does not compile-time-depend on `@borjie/central-
// intelligence`.
// ─────────────────────────────────────────────────────────────────────

export interface ResolvedApprovalPolicy {
  readonly actionType: string;
  readonly source: 'tenant' | 'platform-default' | 'baseline';
  readonly minTotalApprovers: number;
  readonly roleGroups: ReadonlyArray<ApprovalPolicyRoleGroup>;
  readonly maxStaleMinutes: number;
  readonly recallWindowMinutes: number;
  readonly reAuthRequired: boolean;
  readonly reAuthMaxAgeSeconds: number;
  readonly allowProposerSignature: boolean;
}

export interface ApprovalPolicyResolveArgs {
  readonly tenantId: string | null;
  readonly actionType: string;
}

export interface ApprovalPolicyUpsertArgs {
  readonly tenantId: string | null;
  readonly actionType: string;
  readonly minTotalApprovers: number;
  readonly roleGroups: ReadonlyArray<ApprovalPolicyRoleGroup>;
  readonly maxStaleMinutes?: number;
  readonly recallWindowMinutes?: number;
  readonly reAuthRequired?: boolean;
  readonly reAuthMaxAgeSeconds?: number;
  readonly allowProposerSignature?: boolean;
  readonly notes?: string | null;
  readonly updatedBy?: string | null;
}

export interface ApprovalPolicyService {
  resolve(args: ApprovalPolicyResolveArgs): Promise<ResolvedApprovalPolicy>;
  upsert(args: ApprovalPolicyUpsertArgs): Promise<ResolvedApprovalPolicy>;
  remove(args: ApprovalPolicyResolveArgs): Promise<boolean>;
  list(tenantId: string | null): Promise<ReadonlyArray<ResolvedApprovalPolicy>>;
}

// ─────────────────────────────────────────────────────────────────────
// Baseline — the kernel's "any 2 distinct approvers, 24h TTL" floor.
// ─────────────────────────────────────────────────────────────────────

export function defaultBaseline(actionType: string): ResolvedApprovalPolicy {
  return {
    actionType,
    source: 'baseline',
    minTotalApprovers: 2,
    roleGroups: [{ name: 'admin', minApprovers: 2 }],
    maxStaleMinutes: 24 * 60,
    recallWindowMinutes: 0,
    reAuthRequired: false,
    reAuthMaxAgeSeconds: 300,
    allowProposerSignature: false,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────────────

interface ValidatedRoleGroups {
  readonly groups: ReadonlyArray<ApprovalPolicyRoleGroup>;
  readonly minTotal: number;
}

function validateRoleGroups(
  groups: ReadonlyArray<ApprovalPolicyRoleGroup>,
  declaredMinTotal: number,
): ValidatedRoleGroups {
  if (!Array.isArray(groups) || groups.length === 0) {
    throw new Error('approval-policy: roleGroups must be a non-empty array');
  }
  if (groups.length > 5) {
    throw new Error('approval-policy: roleGroups capped at 5 distinct groups');
  }
  const seen = new Set<string>();
  let sum = 0;
  for (const g of groups) {
    if (!g || typeof g !== 'object') {
      throw new Error('approval-policy: every roleGroup must be an object');
    }
    if (typeof g.name !== 'string' || g.name.trim().length === 0) {
      throw new Error('approval-policy: roleGroup.name must be a non-empty string');
    }
    if (!Number.isInteger(g.minApprovers) || g.minApprovers < 1) {
      throw new Error(
        `approval-policy: roleGroup.minApprovers must be a positive integer (got ${String(g.minApprovers)} for "${g.name}")`,
      );
    }
    if (seen.has(g.name)) {
      throw new Error(`approval-policy: duplicate roleGroup.name "${g.name}"`);
    }
    seen.add(g.name);
    sum += g.minApprovers;
  }
  if (!Number.isInteger(declaredMinTotal) || declaredMinTotal < 1 || declaredMinTotal > 5) {
    throw new Error(
      `approval-policy: minTotalApprovers must be an integer in [1, 5] (got ${String(declaredMinTotal)})`,
    );
  }
  if (sum !== declaredMinTotal) {
    throw new Error(
      `approval-policy: sum(roleGroups.minApprovers)=${sum} must equal minTotalApprovers=${declaredMinTotal}`,
    );
  }
  return { groups, minTotal: declaredMinTotal };
}

// ─────────────────────────────────────────────────────────────────────
// Row mapping
// ─────────────────────────────────────────────────────────────────────

interface DbPolicyRow {
  readonly tenantId: string | null;
  readonly actionType: string;
  readonly minTotalApprovers: number;
  readonly roleGroups: unknown;
  readonly maxStaleMinutes: number;
  readonly recallWindowMinutes: number;
  readonly reAuthRequired: boolean;
  readonly reAuthMaxAgeSeconds: number;
  readonly allowProposerSignature: boolean;
}

function readGroups(raw: unknown): ReadonlyArray<ApprovalPolicyRoleGroup> {
  if (!Array.isArray(raw)) return [];
  const out: ApprovalPolicyRoleGroup[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    if (typeof o.name !== 'string') continue;
    if (typeof o.minApprovers !== 'number' || !Number.isInteger(o.minApprovers)) continue;
    out.push({ name: o.name, minApprovers: o.minApprovers });
  }
  return out;
}

function rowToPolicy(
  row: DbPolicyRow,
  source: 'tenant' | 'platform-default',
): ResolvedApprovalPolicy {
  return {
    actionType: row.actionType,
    source,
    minTotalApprovers: row.minTotalApprovers,
    roleGroups: readGroups(row.roleGroups),
    maxStaleMinutes: row.maxStaleMinutes,
    recallWindowMinutes: row.recallWindowMinutes,
    reAuthRequired: row.reAuthRequired,
    reAuthMaxAgeSeconds: row.reAuthMaxAgeSeconds,
    allowProposerSignature: row.allowProposerSignature,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────

export function createApprovalPolicyService(
  db: DatabaseClient,
): ApprovalPolicyService {
  const selectCols = {
    tenantId: approvalPolicyActions.tenantId,
    actionType: approvalPolicyActions.actionType,
    minTotalApprovers: approvalPolicyActions.minTotalApprovers,
    roleGroups: approvalPolicyActions.roleGroups,
    maxStaleMinutes: approvalPolicyActions.maxStaleMinutes,
    recallWindowMinutes: approvalPolicyActions.recallWindowMinutes,
    reAuthRequired: approvalPolicyActions.reAuthRequired,
    reAuthMaxAgeSeconds: approvalPolicyActions.reAuthMaxAgeSeconds,
    allowProposerSignature: approvalPolicyActions.allowProposerSignature,
  };

  return {
    async resolve(args) {
      if (!args.actionType || args.actionType.trim().length === 0) {
        return defaultBaseline(args.actionType ?? 'unknown');
      }

      // 1. Per-tenant row.
      if (args.tenantId && args.tenantId.length > 0) {
        try {
          const rows = await db
            .select(selectCols)
            .from(approvalPolicyActions)
            .where(
              and(
                eq(approvalPolicyActions.tenantId, args.tenantId),
                eq(approvalPolicyActions.actionType, args.actionType),
              ),
            )
            .limit(1);
          const r = Array.isArray(rows) ? rows[0] : undefined;
          if (r) {
            return rowToPolicy(r as DbPolicyRow, 'tenant');
          }
        } catch (error) {
          logger.error('approval-policy.resolve tenant lookup failed', { error: error });
          return defaultBaseline(args.actionType);
        }
      }

      // 2. Platform default.
      try {
        const rows = await db
          .select(selectCols)
          .from(approvalPolicyActions)
          .where(
            and(
              isNull(approvalPolicyActions.tenantId),
              eq(approvalPolicyActions.actionType, args.actionType),
            ),
          )
          .limit(1);
        const r = Array.isArray(rows) ? rows[0] : undefined;
        if (r) {
          return rowToPolicy(r as DbPolicyRow, 'platform-default');
        }
      } catch (error) {
        logger.error('approval-policy.resolve platform lookup failed', { error: error });
        return defaultBaseline(args.actionType);
      }

      // 3. Baseline.
      return defaultBaseline(args.actionType);
    },

    async upsert(args) {
      const validated = validateRoleGroups(
        args.roleGroups,
        args.minTotalApprovers,
      );
      const values = {
        id: randomUUID(),
        tenantId: args.tenantId,
        actionType: args.actionType,
        minTotalApprovers: validated.minTotal,
        roleGroups: validated.groups as ApprovalPolicyRoleGroup[],
        maxStaleMinutes: args.maxStaleMinutes ?? 1440,
        recallWindowMinutes: args.recallWindowMinutes ?? 0,
        reAuthRequired: args.reAuthRequired ?? false,
        reAuthMaxAgeSeconds: args.reAuthMaxAgeSeconds ?? 300,
        allowProposerSignature: args.allowProposerSignature ?? false,
        notes: args.notes ?? null,
        updatedAt: new Date(),
        updatedBy: args.updatedBy ?? null,
      };

      await db
        .insert(approvalPolicyActions)
        .values(values as never)
        .onConflictDoUpdate({
          target: [
            approvalPolicyActions.tenantId,
            approvalPolicyActions.actionType,
          ],
          set: {
            minTotalApprovers: values.minTotalApprovers,
            roleGroups: values.roleGroups,
            maxStaleMinutes: values.maxStaleMinutes,
            recallWindowMinutes: values.recallWindowMinutes,
            reAuthRequired: values.reAuthRequired,
            reAuthMaxAgeSeconds: values.reAuthMaxAgeSeconds,
            allowProposerSignature: values.allowProposerSignature,
            notes: values.notes,
            updatedAt: sql`NOW()`,
            updatedBy: values.updatedBy,
          } as never,
        });

      return {
        actionType: args.actionType,
        source: args.tenantId ? 'tenant' : 'platform-default',
        minTotalApprovers: validated.minTotal,
        roleGroups: validated.groups,
        maxStaleMinutes: values.maxStaleMinutes,
        recallWindowMinutes: values.recallWindowMinutes,
        reAuthRequired: values.reAuthRequired,
        reAuthMaxAgeSeconds: values.reAuthMaxAgeSeconds,
        allowProposerSignature: values.allowProposerSignature,
      };
    },

    async remove(args) {
      try {
        const whereClause = args.tenantId
          ? and(
              eq(approvalPolicyActions.tenantId, args.tenantId),
              eq(approvalPolicyActions.actionType, args.actionType),
            )
          : and(
              isNull(approvalPolicyActions.tenantId),
              eq(approvalPolicyActions.actionType, args.actionType),
            );
        const result = await db
          .delete(approvalPolicyActions)
          .where(whereClause)
          .returning({ id: approvalPolicyActions.id });
        return Array.isArray(result) && result.length > 0;
      } catch (error) {
        logger.error('approval-policy.remove failed', { error: error });
        return false;
      }
    },

    async list(tenantId) {
      try {
        const whereClause = tenantId
          ? eq(approvalPolicyActions.tenantId, tenantId)
          : isNull(approvalPolicyActions.tenantId);
        const rows = await db
          .select(selectCols)
          .from(approvalPolicyActions)
          .where(whereClause);
        return (Array.isArray(rows) ? rows : []).map((r) =>
          rowToPolicy(r as DbPolicyRow, tenantId ? 'tenant' : 'platform-default'),
        );
      } catch (error) {
        logger.error('approval-policy.list failed', { error: error });
        return [];
      }
    },
  };
}
