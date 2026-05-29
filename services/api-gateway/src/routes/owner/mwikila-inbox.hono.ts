/**
 * /api/v1/owner/mwikila-inbox — Mr. Mwikila autonomous-MD "Acting on
 * your behalf" inbox.
 *
 * Routes (all tenant-scoped via JWT + RLS):
 *   GET    /                         list pending + recent inbox rows
 *   POST   /:id/approve              T0/T1 owner one-tap approves
 *   POST   /:id/deny                 T0/T1 owner one-tap denies
 *   POST   /:id/reverse              T2 owner reverses within window
 *
 * The recorder lives in `services/mwikila-autonomy/inbox-recorder.ts`
 * — this file is only the HTTP shape. The autonomous handlers post to
 * the recorder directly via the runtime; the inbox surface is owner-
 * facing only.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';

import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import { createMwikilaInboxRecorder } from '../../services/mwikila-autonomy';
import {
  ACTION_STATUSES,
  DELEGATION_CATEGORIES,
} from '../../services/mwikila-autonomy';
import { MwikilaError } from '../../services/mwikila-autonomy/types.js';

const ListQuerySchema = z.object({
  status: z.enum(ACTION_STATUSES).optional(),
  category: z.enum(DELEGATION_CATEGORIES).optional(),
  limit: z
    .union([
      z.number().int().min(1).max(200),
      z
        .string()
        .regex(/^\d+$/)
        .transform((s) => Number(s)),
    ])
    .optional(),
});

const ReverseBodySchema = z
  .object({
    reversalToken: z.string().uuid(),
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
    const code = err.code;
    const status: number =
      code === 'not_found'
        ? 404
        : code === 'wrong_status' ||
            code === 'reversal_window_expired' ||
            code === 'reversal_token_mismatch'
          ? 409
          : code === 'invalid_input'
            ? 400
            : 500;
    return c.json(
      {
        success: false,
        error: {
          code: `MWIKILA_${code.toUpperCase()}`,
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

export const mwikilaInboxRouter = new Hono();
mwikilaInboxRouter.use('*', authMiddleware);
mwikilaInboxRouter.use('*', databaseMiddleware);

mwikilaInboxRouter.get('/', zValidator('query', ListQuerySchema), async (c) => {
  const auth = c.get('auth');
  const db = c.get('db');
  if (!db) return dbUnavailable(c);

  const { status, category, limit } = c.req.valid('query');
  const recorder = createMwikilaInboxRecorder({ db });
  try {
    // exactOptionalPropertyTypes: only set optional fields when the
    // caller actually provided them; never pass `undefined` literally.
    const rows = status
      ? await recorder.listRecent({
          tenantId: auth.tenantId,
          status,
          ...(category !== undefined ? { category } : {}),
          ...(limit !== undefined ? { limit } : {}),
        })
      : await recorder.listPending({
          tenantId: auth.tenantId,
          ...(limit !== undefined ? { limit } : {}),
        });
    return c.json({ success: true, data: rows });
  } catch (err) {
    return mapMwikilaError(c, err);
  }
});

mwikilaInboxRouter.post('/:id/approve', async (c) => {
  const auth = c.get('auth');
  const db = c.get('db');
  if (!db) return dbUnavailable(c);
  const id = c.req.param('id');
  const recorder = createMwikilaInboxRecorder({ db });
  try {
    const row = await recorder.approveProposal({
      tenantId: auth.tenantId,
      id,
      reviewedByUserId: auth.userId,
    });
    return c.json({ success: true, data: row });
  } catch (err) {
    return mapMwikilaError(c, err);
  }
});

mwikilaInboxRouter.post('/:id/deny', async (c) => {
  const auth = c.get('auth');
  const db = c.get('db');
  if (!db) return dbUnavailable(c);
  const id = c.req.param('id');
  const recorder = createMwikilaInboxRecorder({ db });
  try {
    const row = await recorder.denyProposal({
      tenantId: auth.tenantId,
      id,
      reviewedByUserId: auth.userId,
    });
    return c.json({ success: true, data: row });
  } catch (err) {
    return mapMwikilaError(c, err);
  }
});

mwikilaInboxRouter.post(
  '/:id/reverse',
  zValidator('json', ReverseBodySchema),
  async (c) => {
    const auth = c.get('auth');
    const db = c.get('db');
    if (!db) return dbUnavailable(c);
    const id = c.req.param('id');
    const { reversalToken } = c.req.valid('json');
    const recorder = createMwikilaInboxRecorder({ db });
    try {
      const row = await recorder.reverseExecution({
        tenantId: auth.tenantId,
        id,
        reversalToken,
        reviewedByUserId: auth.userId,
      });
      return c.json({ success: true, data: row });
    } catch (err) {
      return mapMwikilaError(c, err);
    }
  },
);
