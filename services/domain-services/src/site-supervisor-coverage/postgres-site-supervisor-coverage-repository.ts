/**
 * Postgres-backed Site Supervisor Coverage Repository (Borjie mining).
 *
 * Replaces the property-domain station-master-coverage routing repo
 * with a site/shift binding suited for mining ops: which supervisor
 * owns site X during the night shift, who covers across shifts, when
 * the coverage starts and ends.
 *
 * Persists to `site_supervisor_coverage`. Tenant isolation is enforced
 * on every query via `WHERE tenant_id = :ctx`.
 */

import { and, eq, isNull, or, sql } from 'drizzle-orm';
import { siteSupervisorCoverage } from '@borjie/database';
import type { TenantId } from '@borjie/domain-models';
import {
  rowToCoverage,
  SiteSupervisorCoverageError,
  upsertCoverageSchema,
  type SiteSupervisorCoverage,
  type SiteSupervisorCoverageRepository,
  type SupervisorShiftKind,
  type UpsertCoverageInput,
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

export class PostgresSiteSupervisorCoverageRepository
  implements SiteSupervisorCoverageRepository
{
  constructor(private readonly db: DrizzleLike) {}

  async upsert(
    tenantId: TenantId,
    input: UpsertCoverageInput,
  ): Promise<SiteSupervisorCoverage> {
    const validated = upsertCoverageSchema.parse(input);
    const validFrom = new Date(validated.validFrom);
    if (Number.isNaN(validFrom.getTime())) {
      throw new SiteSupervisorCoverageError(
        'invalid validFrom timestamp',
        'VALIDATION',
      );
    }
    const validTo = validated.validTo ? new Date(validated.validTo) : null;
    if (validTo && Number.isNaN(validTo.getTime())) {
      throw new SiteSupervisorCoverageError(
        'invalid validTo timestamp',
        'VALIDATION',
      );
    }
    if (validTo && validTo <= validFrom) {
      throw new SiteSupervisorCoverageError(
        'validTo must be after validFrom',
        'VALIDATION',
      );
    }
    const now = new Date();
    const insertOp = (
      this.db as unknown as {
        insert: (t: typeof siteSupervisorCoverage) => {
          values: (v: Record<string, unknown>) => {
            onConflictDoUpdate?: (cfg: {
              target: unknown;
              set: Record<string, unknown>;
            }) => Promise<unknown>;
          };
        };
      }
    ).insert(siteSupervisorCoverage);
    const op = insertOp.values({
      id: validated.id,
      tenantId: tenantId as unknown as string,
      siteId: validated.siteId,
      supervisorUserId: validated.supervisorUserId,
      shiftKind: validated.shiftKind,
      validFrom,
      validTo,
      metadata: validated.metadata,
      createdAt: now,
      updatedAt: now,
    });
    if (typeof op.onConflictDoUpdate === 'function') {
      await op.onConflictDoUpdate({
        target: siteSupervisorCoverage.id,
        set: {
          siteId: validated.siteId,
          supervisorUserId: validated.supervisorUserId,
          shiftKind: validated.shiftKind,
          validFrom,
          validTo,
          metadata: validated.metadata,
          updatedAt: now,
        },
      });
    } else {
      await op;
    }
    const after = await this.findById(tenantId, validated.id);
    if (!after) {
      throw new Error(
        `upsert failed to persist site-supervisor coverage ${validated.id}`,
      );
    }
    return after;
  }

  async findById(
    tenantId: TenantId,
    id: string,
  ): Promise<SiteSupervisorCoverage | null> {
    const rows = (await (
      this.db as unknown as {
        select: () => {
          from: (t: typeof siteSupervisorCoverage) => {
            where: (cond: unknown) => {
              limit: (n: number) => Promise<readonly Record<string, unknown>[]>;
            };
          };
        };
      }
    )
      .select()
      .from(siteSupervisorCoverage)
      .where(
        and(
          eq(siteSupervisorCoverage.id, id),
          eq(
            siteSupervisorCoverage.tenantId,
            tenantId as unknown as string,
          ),
        ),
      )
      .limit(1)) as readonly Record<string, unknown>[];
    return rows[0] ? rowToCoverage(rows[0]) : null;
  }

  async listForSite(
    tenantId: TenantId,
    siteId: string,
  ): Promise<readonly SiteSupervisorCoverage[]> {
    const rows = (await (
      this.db as unknown as {
        select: () => {
          from: (t: typeof siteSupervisorCoverage) => {
            where: (cond: unknown) => Promise<readonly Record<string, unknown>[]>;
          };
        };
      }
    )
      .select()
      .from(siteSupervisorCoverage)
      .where(
        and(
          eq(
            siteSupervisorCoverage.tenantId,
            tenantId as unknown as string,
          ),
          eq(siteSupervisorCoverage.siteId, siteId),
        ),
      )) as readonly Record<string, unknown>[];
    return rows.map(rowToCoverage);
  }

  async listForSupervisor(
    tenantId: TenantId,
    supervisorUserId: string,
  ): Promise<readonly SiteSupervisorCoverage[]> {
    const rows = (await (
      this.db as unknown as {
        select: () => {
          from: (t: typeof siteSupervisorCoverage) => {
            where: (cond: unknown) => Promise<readonly Record<string, unknown>[]>;
          };
        };
      }
    )
      .select()
      .from(siteSupervisorCoverage)
      .where(
        and(
          eq(
            siteSupervisorCoverage.tenantId,
            tenantId as unknown as string,
          ),
          eq(
            siteSupervisorCoverage.supervisorUserId,
            supervisorUserId,
          ),
        ),
      )) as readonly Record<string, unknown>[];
    return rows.map(rowToCoverage);
  }

  async findActive(
    tenantId: TenantId,
    siteId: string,
    shiftKind: SupervisorShiftKind,
    at?: string,
  ): Promise<SiteSupervisorCoverage | null> {
    const instant = at ? new Date(at) : new Date();
    const shiftCondition = or(
      eq(siteSupervisorCoverage.shiftKind, shiftKind),
      eq(siteSupervisorCoverage.shiftKind, 'all'),
    );
    const where = and(
      eq(siteSupervisorCoverage.tenantId, tenantId as unknown as string),
      eq(siteSupervisorCoverage.siteId, siteId),
      shiftCondition,
      sql`${siteSupervisorCoverage.validFrom} <= ${instant}`,
      or(
        isNull(siteSupervisorCoverage.validTo),
        sql`${siteSupervisorCoverage.validTo} > ${instant}`,
      ),
    );
    const rows = (await (
      this.db as unknown as {
        select: () => {
          from: (t: typeof siteSupervisorCoverage) => {
            where: (cond: unknown) => {
              limit: (n: number) => Promise<readonly Record<string, unknown>[]>;
            };
          };
        };
      }
    )
      .select()
      .from(siteSupervisorCoverage)
      .where(where)
      .limit(50)) as readonly Record<string, unknown>[];
    if (rows.length === 0) return null;
    const matches = rows.map(rowToCoverage);
    // Prefer an exact shift match over a fallback 'all' row.
    const exact = matches.find((m) => m.shiftKind === shiftKind);
    return exact ?? matches[0]!;
  }

  async endCoverage(
    tenantId: TenantId,
    id: string,
    endAt: string,
  ): Promise<SiteSupervisorCoverage> {
    const endDate = new Date(endAt);
    if (Number.isNaN(endDate.getTime())) {
      throw new SiteSupervisorCoverageError(
        'invalid endAt timestamp',
        'VALIDATION',
      );
    }
    await (
      this.db as unknown as {
        update: (t: typeof siteSupervisorCoverage) => {
          set: (v: Record<string, unknown>) => {
            where: (cond: unknown) => Promise<unknown>;
          };
        };
      }
    )
      .update(siteSupervisorCoverage)
      .set({ validTo: endDate, updatedAt: new Date() })
      .where(
        and(
          eq(siteSupervisorCoverage.id, id),
          eq(
            siteSupervisorCoverage.tenantId,
            tenantId as unknown as string,
          ),
        ),
      );
    const after = await this.findById(tenantId, id);
    if (!after) {
      throw new SiteSupervisorCoverageError(
        `site-supervisor coverage ${id} not found after endCoverage`,
        'NOT_FOUND',
      );
    }
    return after;
  }
}
