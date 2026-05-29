/**
 * /api/v1/owner/delegation — owner-set delegation tier per category
 * for Mr. Mwikila autonomous-MD.
 *
 * Routes (all tenant-scoped via JWT + RLS):
 *   GET    /            list per-category effective delegation
 *   PATCH  /            upsert a single category's delegation
 *
 * The list endpoint always returns 12 entries — one per category —
 * with the EFFECTIVE delegation (owner override or category default).
 * The UI renders this as the 12 × 4 matrix.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';

import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import {
  DELEGATION_CATEGORIES,
  DELEGATION_TIERS,
  createMwikilaDelegationStore,
} from '../../services/mwikila-autonomy';
import { MwikilaError } from '../../services/mwikila-autonomy/types.js';

const PatchSchema = z
  .object({
    category: z.enum(DELEGATION_CATEGORIES),
    tier: z.enum(DELEGATION_TIERS),
    reversalWindowHours: z.number().int().min(1).max(168).nullable().optional(),
    envelopeThresholdTzs: z.number().min(0).nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
  })
  .strict();

function dbUnavailable(c: any) {
  return c.json(
    {
      success: false,
      error: {
        code: 'DATABASE_UNAVAILABLE',
        message: 'Database client is not initialized',
      },
    },
    503,
  );
}

function mapMwikilaError(c: any, err: unknown) {
  if (err instanceof MwikilaError) {
    const status: number = err.code === 'invalid_input' ? 400 : 500;
    return c.json(
      {
        success: false,
        error: {
          code: `MWIKILA_${err.code.toUpperCase()}`,
          message: err.message,
        },
      },
      status,
    );
  }
  return c.json(
    {
      success: false,
      error: {
        code: 'MWIKILA_INTERNAL',
        message: err instanceof Error ? err.message : String(err),
      },
    },
    500,
  );
}

export const delegationRouter = new Hono();
delegationRouter.use('*', authMiddleware);
delegationRouter.use('*', databaseMiddleware);

delegationRouter.get('/', async (c) => {
  const auth = c.get('auth');
  const db = c.get('db');
  if (!db) return dbUnavailable(c);
  const store = createMwikilaDelegationStore({ db });
  try {
    const matrix = await Promise.all(
      // `store.resolve()` already returns a row keyed by `category`; spread
      // first so the explicit binding is the authoritative one and TS2783
      // (duplicate property) goes away.
      DELEGATION_CATEGORIES.map(async (category) => ({
        ...(await store.resolve({ tenantId: auth.tenantId, category })),
        category,
      })),
    );
    return c.json({ success: true, data: matrix });
  } catch (err) {
    return mapMwikilaError(c, err);
  }
});

delegationRouter.patch('/', zValidator('json', PatchSchema), async (c) => {
  const auth = c.get('auth');
  const db = c.get('db');
  if (!db) return dbUnavailable(c);
  const store = createMwikilaDelegationStore({ db });
  const body = c.req.valid('json');
  try {
    const pref = await store.upsert({
      tenantId: auth.tenantId,
      category: body.category,
      tier: body.tier,
      reversalWindowHours: body.reversalWindowHours ?? null,
      envelopeThresholdTzs: body.envelopeThresholdTzs ?? null,
      setByUserId: auth.userId,
      notes: body.notes ?? null,
    });
    return c.json({ success: true, data: pref });
  } catch (err) {
    return mapMwikilaError(c, err);
  }
});
