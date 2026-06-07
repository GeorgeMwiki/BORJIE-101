/**
 * /api/v1/mining/internal/ab-tests — HQ A/B experiment harness (I-W-08).
 *
 * SUPER_ADMIN / ADMIN only. CRUD-lite over the REAL `ab_experiments`
 * table (migration 0300):
 *
 *   GET  /                    list experiments (newest first)
 *   POST /                    create an experiment (variant + junior + …)
 *   POST /:id/promote-winner  mark an experiment 'promoted' + stamp
 *                             promoted_at (the "promote winner" action).
 *
 * `ab_experiments` is PLATFORM/HQ infrastructure — an experiment spans
 * many tenants, so the table is intentionally NOT tenant-RLS-scoped (its
 * `tenant_id` is nullable). Access is gated here at the route layer to
 * platform admins, mirroring `feature-flags.hono.ts` / `tenants.hono.ts`.
 * The optional `tenantId` on an experiment merely pins it to one tenant's
 * traffic; it is validated as a string, never trusted as an RLS boundary.
 *
 * Per CLAUDE.md: Drizzle only, zod-validated body, immutability, no
 * `console.log` (Pino via createLogger), never a hard-coded currency
 * (there are no money columns here).
 *
 * Mounted at `/api/v1/mining/internal/ab-tests`.
 */

import { Hono } from 'hono';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { abExperiments } from '@borjie/database';
import { authMiddleware, requireRole } from '../../../middleware/hono-auth';
import { databaseMiddleware } from '../../../middleware/database';
import { UserRole } from '../../../types/user-role';
import { createLogger } from '../../../utils/logger';

const moduleLogger = createLogger('admin-ab-tests');

const CreateExperimentSchema = z.object({
  variant: z.string().min(1).max(300),
  junior: z.string().min(1).max(120),
  goldenScore: z.number().min(0).max(1).optional(),
  canaryTenants: z.array(z.string().min(1).max(200)).max(200).optional(),
  tenantId: z.string().min(1).max(200).optional(),
  notes: z.string().max(2000).optional(),
});

const IdParamSchema = z.object({ id: z.string().uuid() });

interface ExperimentRow {
  readonly id: string;
  readonly tenantId: string | null;
  readonly variant: string;
  readonly junior: string;
  readonly goldenScore: number | null;
  readonly canaryTenants: ReadonlyArray<string>;
  readonly status: string;
  readonly notes: string | null;
  readonly createdBy: string | null;
  readonly promotedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

function isoOf(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  return null;
}

function projectRow(row: Record<string, unknown>): ExperimentRow {
  const canary = row.canaryTenants ?? row.canary_tenants;
  return {
    id: String(row.id ?? ''),
    tenantId:
      row.tenantId != null
        ? String(row.tenantId)
        : row.tenant_id != null
          ? String(row.tenant_id)
          : null,
    variant: String(row.variant ?? ''),
    junior: String(row.junior ?? ''),
    goldenScore:
      row.goldenScore != null
        ? Number(row.goldenScore)
        : row.golden_score != null
          ? Number(row.golden_score)
          : null,
    canaryTenants: Array.isArray(canary) ? canary.map(String) : [],
    status: String(row.status ?? 'running'),
    notes: row.notes != null ? String(row.notes) : null,
    createdBy:
      row.createdBy != null
        ? String(row.createdBy)
        : row.created_by != null
          ? String(row.created_by)
          : null,
    promotedAt: isoOf(row.promotedAt ?? row.promoted_at),
    createdAt: isoOf(row.createdAt ?? row.created_at) ?? new Date(0).toISOString(),
    updatedAt: isoOf(row.updatedAt ?? row.updated_at) ?? new Date(0).toISOString(),
  };
}

export function createMiningInternalAbTestsRouter(): Hono {
  const app = new Hono();
  app.use('*', authMiddleware);
  app.use('*', requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN));
  app.use('*', databaseMiddleware);

  // ── GET / — experiment list (newest first) ────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.get('/', async (c: any) => {
    const db = c.get('db');
    if (!db) return unavailable(c);
    try {
      const rows = await db
        .select()
        .from(abExperiments)
        .orderBy(desc(abExperiments.createdAt))
        .limit(200);
      const data = (rows as ReadonlyArray<Record<string, unknown>>).map(
        projectRow,
      );
      return c.json(
        { success: true as const, data, meta: { count: data.length } },
        200,
      );
    } catch (err) {
      return failure(c, err, 'list');
    }
  });

  // ── POST / — create an experiment ─────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.post('/', async (c: any) => {
    const db = c.get('db');
    if (!db) return unavailable(c);
    const { userId } = c.get('auth') as { userId?: string };

    const raw = await c.req.json().catch(() => null);
    const parsed = CreateExperimentSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json(
        {
          success: false as const,
          error: { code: 'BAD_REQUEST', message: parsed.error.message },
        },
        400,
      );
    }
    const input = parsed.data;

    try {
      const now = new Date();
      const [row] = await db
        .insert(abExperiments)
        .values({
          tenantId: input.tenantId ?? null,
          variant: input.variant,
          junior: input.junior,
          goldenScore: input.goldenScore ?? null,
          canaryTenants: input.canaryTenants ?? [],
          status: 'running',
          notes: input.notes ?? null,
          createdBy: userId ?? null,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      return c.json(
        { success: true as const, data: projectRow(row as Record<string, unknown>) },
        201,
      );
    } catch (err) {
      return failure(c, err, 'create');
    }
  });

  // ── POST /:id/promote-winner — flip to 'promoted' + stamp time ────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.post('/:id/promote-winner', async (c: any) => {
    const db = c.get('db');
    if (!db) return unavailable(c);

    const parsed = IdParamSchema.safeParse({ id: c.req.param('id') });
    if (!parsed.success) {
      return c.json(
        {
          success: false as const,
          error: { code: 'BAD_REQUEST', message: parsed.error.message },
        },
        400,
      );
    }
    const { id } = parsed.data;

    try {
      const now = new Date();
      const [row] = await db
        .update(abExperiments)
        .set({ status: 'promoted', promotedAt: now, updatedAt: now })
        .where(eq(abExperiments.id, id))
        .returning();
      if (!row) {
        return c.json(
          {
            success: false as const,
            error: { code: 'NOT_FOUND', message: 'Experiment not found' },
          },
          404,
        );
      }
      return c.json(
        { success: true as const, data: projectRow(row as Record<string, unknown>) },
        200,
      );
    } catch (err) {
      return failure(c, err, 'promote');
    }
  });

  return app;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function unavailable(c: any): Response {
  return c.json(
    {
      success: false as const,
      error: {
        code: 'AB_TESTS_UNAVAILABLE',
        message: 'database is not configured on this gateway',
      },
    },
    503,
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function failure(c: any, err: unknown, scope: string): Response {
  const reason = err instanceof Error ? err.message : String(err);
  moduleLogger.error('ab-tests operation failed', {
    evt: 'admin_ab_tests_failed',
    scope,
    reason,
  });
  return c.json(
    {
      success: false as const,
      error: { code: 'AB_TESTS_FAILED', message: reason },
    },
    500,
  );
}

export const miningInternalAbTestsRouter = createMiningInternalAbTestsRouter();
export default miningInternalAbTestsRouter;
