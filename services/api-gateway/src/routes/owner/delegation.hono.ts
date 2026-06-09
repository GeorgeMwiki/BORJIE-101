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
import { sql } from 'drizzle-orm';

import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import {
  DELEGATION_CATEGORIES,
  DELEGATION_TIERS,
  createMwikilaDelegationStore,
} from '../../services/mwikila-autonomy';
import { MwikilaError } from '../../services/mwikila-autonomy/types.js';
import { createLogger } from '../../utils/logger';

const moduleLogger = createLogger('owner-delegation');

/**
 * Tier ordinal — T0 (inform-only) is the MOST restrictive, T3 the most
 * autonomous. A lower ordinal means a tighter leash.
 */
function tierOrdinal(tier: string): number {
  switch (tier) {
    case 'T0':
      return 0;
    case 'T1':
      return 1;
    case 'T2':
      return 2;
    case 'T3':
      return 3;
    default:
      return 0;
  }
}

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
    // owner-ceo-9: capture the prior EFFECTIVE tier BEFORE the upsert so we
    // can tell whether the owner just tightened the leash on this category.
    const priorResolved = await store.resolve({
      tenantId: auth.tenantId,
      category: body.category,
    });

    const pref = await store.upsert({
      tenantId: auth.tenantId,
      category: body.category,
      tier: body.tier,
      reversalWindowHours: body.reversalWindowHours ?? null,
      envelopeThresholdTzs: body.envelopeThresholdTzs ?? null,
      setByUserId: auth.userId,
      notes: body.notes ?? null,
    });

    // owner-ceo-9: when the new tier is MORE restrictive than the prior
    // effective tier (e.g. T2→T0), any in-flight `proposed` inbox rows for
    // this category were proposed under the looser tier and would still be
    // approved/executed at stale semantics. Expire them so the autonomy
    // engine re-proposes under the new tier on its next tick — the owner
    // never approves a stale-tier action. This is a tenant-scoped UPDATE
    // under the RLS GUC databaseMiddleware already bound. Best-effort: a
    // failure here must not fail the tier change itself.
    let staleProposalsExpired = 0;
    if (tierOrdinal(body.tier) < tierOrdinal(priorResolved.tier)) {
      try {
        const result = await db.execute(sql`
          UPDATE mwikila_actions_inbox
             SET status = 'expired',
                 updated_at = now()
           WHERE tenant_id = ${auth.tenantId}
             AND category = ${body.category}
             AND status = 'proposed'
          RETURNING id
        `);
        const rows = Array.isArray(result)
          ? result
          : ((result as { rows?: ReadonlyArray<unknown> }).rows ?? []);
        staleProposalsExpired = rows.length;
        if (staleProposalsExpired > 0) {
          moduleLogger.info('delegation tier tightened — expired stale proposals', {
            tenantId: auth.tenantId,
            category: body.category,
            priorTier: priorResolved.tier,
            newTier: body.tier,
            expired: staleProposalsExpired,
          });
        }
      } catch (expireErr) {
        moduleLogger.warn('delegation: stale-proposal expiry failed (tier change kept)', {
          tenantId: auth.tenantId,
          category: body.category,
          reason: expireErr instanceof Error ? expireErr.message : String(expireErr),
        });
      }
    }

    return c.json({
      success: true,
      data: pref,
      meta: { staleProposalsExpired },
    });
  } catch (err) {
    return mapMwikilaError(c, err);
  }
});
