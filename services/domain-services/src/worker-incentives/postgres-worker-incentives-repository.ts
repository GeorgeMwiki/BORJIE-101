/**
 * Postgres-backed Worker Incentives Repository (Borjie mining).
 *
 * Tracks per-worker safety badges, productivity rewards, attendance
 * streaks, and incident-free milestones. Append-only ledger of
 * incentives keyed by (tenant, user).
 *
 * Persists to `worker_incentives`. Every query enforces row-level
 * tenant isolation via `WHERE tenant_id = :ctx`.
 */

import { and, desc, eq } from 'drizzle-orm';
import { workerIncentives } from '@borjie/database';
import type { TenantId } from '@borjie/domain-models';
import {
  awardIncentiveSchema,
  rowToIncentive,
  WORKER_INCENTIVE_KINDS,
  type AwardIncentiveInput,
  type WorkerIncentive,
  type WorkerIncentiveKind,
  type WorkerIncentivesRepository,
  type WorkerIncentiveSummary,
} from './types.js';

// ---------------------------------------------------------------------------
// Drizzle client surface
// ---------------------------------------------------------------------------

interface DrizzleLike {
  select: (...args: unknown[]) => unknown;
  insert: (...args: unknown[]) => unknown;
  update: (...args: unknown[]) => unknown;
  [k: string]: unknown;
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

export class PostgresWorkerIncentivesRepository
  implements WorkerIncentivesRepository
{
  constructor(private readonly db: DrizzleLike) {}

  async award(
    tenantId: TenantId,
    input: AwardIncentiveInput,
  ): Promise<WorkerIncentive> {
    const validated = awardIncentiveSchema.parse(input);
    const now = new Date();
    const insertOp = (
      this.db as unknown as {
        insert: (t: typeof workerIncentives) => {
          values: (v: Record<string, unknown>) => Promise<unknown>;
        };
      }
    ).insert(workerIncentives);
    await insertOp.values({
      id: validated.id,
      tenantId: tenantId as unknown as string,
      userId: validated.userId,
      kind: validated.kind,
      points: validated.points,
      reason: validated.reason ?? null,
      metadata: validated.metadata,
      awardedAt: now,
      awardedByUserId: validated.awardedByUserId ?? null,
      createdAt: now,
    });
    const created = await this.findById(tenantId, validated.id);
    if (!created) {
      throw new Error(
        `award failed to persist worker incentive ${validated.id}`,
      );
    }
    return created;
  }

  async findById(
    tenantId: TenantId,
    id: string,
  ): Promise<WorkerIncentive | null> {
    const rows = (await (
      this.db as unknown as {
        select: () => {
          from: (t: typeof workerIncentives) => {
            where: (cond: unknown) => {
              limit: (n: number) => Promise<readonly Record<string, unknown>[]>;
            };
          };
        };
      }
    )
      .select()
      .from(workerIncentives)
      .where(
        and(
          eq(workerIncentives.id, id),
          eq(workerIncentives.tenantId, tenantId as unknown as string),
        ),
      )
      .limit(1)) as readonly Record<string, unknown>[];
    return rows[0] ? rowToIncentive(rows[0]) : null;
  }

  async listForUser(
    tenantId: TenantId,
    userId: string,
    limit = 100,
  ): Promise<readonly WorkerIncentive[]> {
    const rows = (await (
      this.db as unknown as {
        select: () => {
          from: (t: typeof workerIncentives) => {
            where: (cond: unknown) => {
              orderBy: (col: unknown) => {
                limit: (n: number) => Promise<readonly Record<string, unknown>[]>;
              };
            };
          };
        };
      }
    )
      .select()
      .from(workerIncentives)
      .where(
        and(
          eq(workerIncentives.tenantId, tenantId as unknown as string),
          eq(workerIncentives.userId, userId),
        ),
      )
      .orderBy(desc(workerIncentives.awardedAt))
      .limit(limit)) as readonly Record<string, unknown>[];
    return rows.map(rowToIncentive);
  }

  async listForTenant(
    tenantId: TenantId,
    options: {
      readonly kind?: WorkerIncentiveKind;
      readonly limit?: number;
    } = {},
  ): Promise<readonly WorkerIncentive[]> {
    const limit = options.limit ?? 200;
    const where = options.kind
      ? and(
          eq(workerIncentives.tenantId, tenantId as unknown as string),
          eq(workerIncentives.kind, options.kind),
        )
      : eq(workerIncentives.tenantId, tenantId as unknown as string);
    const rows = (await (
      this.db as unknown as {
        select: () => {
          from: (t: typeof workerIncentives) => {
            where: (cond: unknown) => {
              orderBy: (col: unknown) => {
                limit: (n: number) => Promise<readonly Record<string, unknown>[]>;
              };
            };
          };
        };
      }
    )
      .select()
      .from(workerIncentives)
      .where(where)
      .orderBy(desc(workerIncentives.awardedAt))
      .limit(limit)) as readonly Record<string, unknown>[];
    return rows.map(rowToIncentive);
  }

  async summaryForUser(
    tenantId: TenantId,
    userId: string,
  ): Promise<WorkerIncentiveSummary> {
    // We sum + count in-process. The volume per user is bounded (~hundreds
    // of incentives over a worker's tenure), so an aggregate query is
    // overkill for the pilot and adds another moving part to maintain.
    const rows = await this.listForUser(tenantId, userId, 1000);
    const countByKind = Object.fromEntries(
      WORKER_INCENTIVE_KINDS.map((k) => [k, 0]),
    ) as Record<WorkerIncentiveKind, number>;
    let totalPoints = 0;
    let lastAwardedAt: string | null = null;
    for (const r of rows) {
      totalPoints += r.points;
      countByKind[r.kind] = (countByKind[r.kind] ?? 0) + 1;
      if (lastAwardedAt === null || r.awardedAt > lastAwardedAt) {
        lastAwardedAt = r.awardedAt;
      }
    }
    return {
      userId,
      totalPoints,
      countByKind,
      lastAwardedAt,
    };
  }
}
