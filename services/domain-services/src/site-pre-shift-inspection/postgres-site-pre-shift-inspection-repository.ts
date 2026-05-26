/**
 * Postgres-backed Site Pre-Shift Inspection Repository (Borjie mining).
 *
 * Captures the daily pre-shift safety checklist that a supervisor
 * completes per drill rig (or other heavy asset) before the crew can
 * start the shift. Records pass / fail / NA per checklist item, the
 * overall verdict, and the sign-off identity.
 *
 * Persists to `pre_shift_inspections`. Row-level tenant isolation is
 * enforced via `WHERE tenant_id = :ctx` on every query.
 */

import { and, desc, eq } from 'drizzle-orm';
import { preShiftInspections } from '@borjie/database';
import type { TenantId } from '@borjie/domain-models';
import {
  deriveOverallStatus,
  recordInspectionSchema,
  rowToInspection,
  signOffInspectionSchema,
  SitePreShiftInspectionError,
  type PreShiftInspection,
  type RecordInspectionInput,
  type SignOffInspectionInput,
  type SitePreShiftInspectionRepository,
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

export class PostgresSitePreShiftInspectionRepository
  implements SitePreShiftInspectionRepository
{
  constructor(private readonly db: DrizzleLike) {}

  async recordInspection(
    tenantId: TenantId,
    input: RecordInspectionInput,
  ): Promise<PreShiftInspection> {
    const validated = recordInspectionSchema.parse(input);
    const overallStatus = deriveOverallStatus(validated.checklist);
    const now = new Date();
    await (
      this.db as unknown as {
        insert: (t: typeof preShiftInspections) => {
          values: (v: Record<string, unknown>) => Promise<unknown>;
        };
      }
    )
      .insert(preShiftInspections)
      .values({
        id: validated.id,
        tenantId: tenantId as unknown as string,
        siteId: validated.siteId,
        assetId: validated.assetId,
        supervisorUserId: validated.supervisorUserId,
        shiftKind: validated.shiftKind,
        checklist: validated.checklist,
        overallStatus,
        signOffUserId: null,
        signOffAt: null,
        notes: validated.notes ?? null,
        evidenceIds: validated.evidenceIds,
        createdAt: now,
        updatedAt: now,
      });
    const created = await this.findById(tenantId, validated.id);
    if (!created) {
      throw new Error(
        `recordInspection failed to persist pre-shift inspection ${validated.id}`,
      );
    }
    return created;
  }

  async findById(
    tenantId: TenantId,
    id: string,
  ): Promise<PreShiftInspection | null> {
    const rows = (await (
      this.db as unknown as {
        select: () => {
          from: (t: typeof preShiftInspections) => {
            where: (cond: unknown) => {
              limit: (n: number) => Promise<readonly Record<string, unknown>[]>;
            };
          };
        };
      }
    )
      .select()
      .from(preShiftInspections)
      .where(
        and(
          eq(preShiftInspections.id, id),
          eq(preShiftInspections.tenantId, tenantId as unknown as string),
        ),
      )
      .limit(1)) as readonly Record<string, unknown>[];
    return rows[0] ? rowToInspection(rows[0]) : null;
  }

  async listForSite(
    tenantId: TenantId,
    siteId: string,
    limit = 100,
  ): Promise<readonly PreShiftInspection[]> {
    const rows = (await (
      this.db as unknown as {
        select: () => {
          from: (t: typeof preShiftInspections) => {
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
      .from(preShiftInspections)
      .where(
        and(
          eq(preShiftInspections.tenantId, tenantId as unknown as string),
          eq(preShiftInspections.siteId, siteId),
        ),
      )
      .orderBy(desc(preShiftInspections.createdAt))
      .limit(limit)) as readonly Record<string, unknown>[];
    return rows.map(rowToInspection);
  }

  async listForAsset(
    tenantId: TenantId,
    assetId: string,
    limit = 50,
  ): Promise<readonly PreShiftInspection[]> {
    const rows = (await (
      this.db as unknown as {
        select: () => {
          from: (t: typeof preShiftInspections) => {
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
      .from(preShiftInspections)
      .where(
        and(
          eq(preShiftInspections.tenantId, tenantId as unknown as string),
          eq(preShiftInspections.assetId, assetId),
        ),
      )
      .orderBy(desc(preShiftInspections.createdAt))
      .limit(limit)) as readonly Record<string, unknown>[];
    return rows.map(rowToInspection);
  }

  async listPending(
    tenantId: TenantId,
  ): Promise<readonly PreShiftInspection[]> {
    const rows = (await (
      this.db as unknown as {
        select: () => {
          from: (t: typeof preShiftInspections) => {
            where: (cond: unknown) => {
              orderBy: (col: unknown) => Promise<readonly Record<string, unknown>[]>;
            };
          };
        };
      }
    )
      .select()
      .from(preShiftInspections)
      .where(
        and(
          eq(preShiftInspections.tenantId, tenantId as unknown as string),
          eq(preShiftInspections.overallStatus, 'sign_off_pending'),
        ),
      )
      .orderBy(desc(preShiftInspections.createdAt))) as readonly Record<
      string,
      unknown
    >[];
    return rows.map(rowToInspection);
  }

  async signOff(
    tenantId: TenantId,
    id: string,
    input: SignOffInspectionInput,
  ): Promise<PreShiftInspection> {
    const validated = signOffInspectionSchema.parse(input);
    const current = await this.findById(tenantId, id);
    if (!current) {
      throw new SitePreShiftInspectionError(
        `pre-shift inspection ${id} not found`,
        'NOT_FOUND',
      );
    }
    if (current.overallStatus === 'failed') {
      throw new SitePreShiftInspectionError(
        'cannot sign off a failed pre-shift inspection',
        'INVALID_TRANSITION',
      );
    }
    if (current.signOffUserId) {
      throw new SitePreShiftInspectionError(
        'pre-shift inspection already signed off',
        'INVALID_TRANSITION',
      );
    }
    const now = new Date();
    await (
      this.db as unknown as {
        update: (t: typeof preShiftInspections) => {
          set: (v: Record<string, unknown>) => {
            where: (cond: unknown) => Promise<unknown>;
          };
        };
      }
    )
      .update(preShiftInspections)
      .set({
        signOffUserId: validated.signOffUserId,
        signOffAt: now,
        overallStatus: 'passed',
        updatedAt: now,
      })
      .where(
        and(
          eq(preShiftInspections.id, id),
          eq(preShiftInspections.tenantId, tenantId as unknown as string),
        ),
      );
    const after = await this.findById(tenantId, id);
    if (!after) {
      throw new Error(`pre-shift inspection ${id} not found after sign-off`);
    }
    return after;
  }
}
