/**
 * Feedback router — Wave 18 real-data wiring.
 *
 *   POST /                            — submit feedback
 *   GET  /                            — tenant-scoped feedback list
 *   GET  /:id                         — single feedback
 *   POST /complaints                  — create complaint (delegates to /api/v1/complaints logic)
 *   GET  /complaints/:id              — single complaint
 *   PUT  /complaints/:id/resolve      — mark complaint resolved
 *
 * Persists to `feedback_submissions` + `complaint_records` (migration
 * 0092). Previously the whole router was fixture data gated behind
 * `liveDataRequired`, which forced every GET to 503.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { and, desc, eq } from 'drizzle-orm';
import {
  feedbackSubmissions,
  complaintRecords,
} from '@borjie/database';
import { authMiddleware } from '../middleware/hono-auth';
import { routeCatch } from '../utils/safe-error';
import { getDbFromServices } from '../utils/services-accessor';

import { withSecurityEvents } from '@borjie/observability';
// Learning Amplification (LitFin port) — turn-thumbs feedback feeds
// the Bayesian roll-up. Thumbs-up records `answer_accepted`; thumbs-
// down with correction text becomes `claim_corrected_by_user`;
// thumbs-down alone becomes `claim_disputed_by_user`. The high-signal
// kinds also synchronously pull truth_claims confidence toward 0.3-0.4
// via observation-recorder's immediate shift, so the next user query
// is already smarter. Fire-and-forget; never blocks the response.
import { recordObservation } from '@borjie/learning-amplification';
// Legacy feedback shape — long-form bug/feature/etc submissions captured
// from staff/tenant surveys. Persists to `feedback_submissions`.
const legacyFeedbackSchema = z.object({
  type: z.enum(['general', 'bug', 'feature', 'improvement']),
  subject: z.string().min(1).max(200),
  message: z.string().min(1).max(5000),
  rating: z.number().int().min(1).max(5).optional(),
  context: z.record(z.unknown()).optional(),
});

// Turn-feedback shape — Jarvis 👍 / 👎 click on a specific assistant turn.
// `signal` accepts the short ('up'|'down') and verbose
// ('thumbs-up'|'thumbs-down') forms because both ship in the field today
// (the Jarvis console POSTs the verbose form, internal callers use the
// short form). Normalised on the wire to the legacy schema's `type` so
// downstream analytics stay uniform.
const turnFeedbackSchema = z.object({
  turnId: z.string().min(1).max(200),
  threadId: z.string().min(1).max(200).nullable(),
  signal: z.enum(['up', 'down', 'thumbs-up', 'thumbs-down']),
  correctionText: z.string().max(5000).nullable().optional(),
  context: z.record(z.unknown()).optional(),
});

// Union schema — the route accepts both shapes and dispatches by the
// presence of `turnId`. We rely on Zod's discriminated-union-by-key
// behaviour via a regular union (the two object shapes don't overlap on
// any required key, so the parser picks the right branch).
const submitFeedbackSchema = z.union([legacyFeedbackSchema, turnFeedbackSchema]);

type LegacyFeedbackInput = z.infer<typeof legacyFeedbackSchema>;
type TurnFeedbackInput = z.infer<typeof turnFeedbackSchema>;

function isTurnFeedback(
  body: LegacyFeedbackInput | TurnFeedbackInput,
): body is TurnFeedbackInput {
  return typeof (body as TurnFeedbackInput).turnId === 'string';
}

function normaliseSignal(
  signal: TurnFeedbackInput['signal'],
): 'up' | 'down' {
  return signal === 'up' || signal === 'thumbs-up' ? 'up' : 'down';
}

const createComplaintSchema = z.object({
  subject: z.string().min(1).max(200),
  description: z.string().min(1).max(5000),
  category: z.enum(['maintenance', 'neighbor', 'payment', 'lease', 'other']).optional(),
  relatedEntityType: z.string().optional(),
  relatedEntityId: z.string().optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
});

const resolveComplaintSchema = z.object({
  resolution: z.string().min(1).max(2000),
  resolutionNotes: z.string().max(1000).optional(),
});

const app = new Hono();
app.use('*', authMiddleware);

function dbUnavailable(c) {
  return c.json(
    {
      success: false,
      error: {
        code: 'DATABASE_UNAVAILABLE',
        message: 'Feedback requires a live DATABASE_URL.',
      },
    },
    503,
  );
}

function newId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

// --- Feedback endpoints -----------------------------------------------------

app.post('/', zValidator('json', submitFeedbackSchema), withSecurityEvents({ action: 'feedback.create', resource: 'feedback', severity: 'info' }, async (c) => {
  const db = getDbFromServices(c);
  if (!db) return dbUnavailable(c);
  const auth = c.get('auth');
  const body = c.req.valid('json') as LegacyFeedbackInput | TurnFeedbackInput;
  try {
    const id = newId('fbk');
    if (isTurnFeedback(body)) {
      // Turn-feedback path — Jarvis thumbs click on a specific assistant
      // turn. Persisted into `feedback_submissions` with a stable
      // `type: 'turn-thumbs'` discriminator so analytics can fan it out
      // without a new table. The original turn/thread identifiers + raw
      // signal + optional correction text are captured in `context` so
      // the downstream rejudge/eval workflow can replay them.
      // Follow-up tier-2 (#33): split into a dedicated `turn_feedback` table with a
      // foreign key to the kernel provenance row when the kernel-eval
      // pipeline lands. For now we share the storage but keep the rows
      // queryable via the `type` index.
      const signal = normaliseSignal(body.signal);
      await db.insert(feedbackSubmissions).values({
        id,
        tenantId: auth.tenantId,
        userId: auth.userId,
        type: 'turn-thumbs',
        subject: `Jarvis turn ${signal === 'up' ? '👍' : '👎'}`,
        message: body.correctionText ?? '',
        rating: signal === 'up' ? 5 : 1,
        context: {
          ...(body.context ?? {}),
          turnId: body.turnId,
          threadId: body.threadId,
          signal,
          correctionText: body.correctionText ?? null,
        },
        status: 'submitted',
      });
      // Learning Amplification (LitFin port) — record the turn-feedback
      // as a learning observation so the nightly amplification job can
      // ratchet claim confidence up (on confirms) or down (on
      // disputes). userIdHash is auth.userId — the recorder SHA-256s
      // it before insert (BorjieMark privacy invariant).
      const kind: 'answer_accepted' | 'claim_corrected_by_user' | 'claim_disputed_by_user' =
        signal === 'up'
          ? 'answer_accepted'
          : body.correctionText && body.correctionText.length > 0
            ? 'claim_corrected_by_user'
            : 'claim_disputed_by_user';
      void recordObservation({
        kind,
        subjectKey: body.turnId,
        userIdHash: auth.userId,
        tenantId: auth.tenantId,
        correlationId: body.threadId ?? undefined,
        evidence: body.correctionText
          ? { userText: body.correctionText }
          : undefined,
      }).catch(() => {
        /* never bubble */
      });
      return c.json(
        {
          success: true,
          data: {
            id,
            status: 'submitted',
            turnId: body.turnId,
            signal,
            accepted: true,
          },
        },
        201,
      );
    }

    // Legacy path — long-form survey feedback.
    await db.insert(feedbackSubmissions).values({
      id,
      tenantId: auth.tenantId,
      userId: auth.userId,
      type: body.type,
      subject: body.subject,
      message: body.message,
      rating: body.rating,
      context: body.context ?? {},
      status: 'submitted',
    });
    return c.json({ success: true, data: { id, status: 'submitted' } }, 201);
  } catch (err) {
    return routeCatch(c, err, {
      code: 'FEEDBACK_WRITE_FAILED',
      status: 503,
      fallback: 'Feedback write failed',
    });
  }
}));

app.get('/', async (c) => {
  const db = getDbFromServices(c);
  if (!db) return dbUnavailable(c);
  const tenantId = c.get('tenantId');
  const limit = Math.min(200, Math.max(1, Number(c.req.query('limit') ?? '50') || 50));
  const type = c.req.query('type');
  try {
    const rows = await db
      .select()
      .from(feedbackSubmissions)
      .where(
        type
          ? and(
              eq(feedbackSubmissions.tenantId, tenantId),
              eq(feedbackSubmissions.type, type),
            )
          : eq(feedbackSubmissions.tenantId, tenantId),
      )
      .orderBy(desc(feedbackSubmissions.createdAt))
      .limit(limit);
    return c.json({ success: true, data: rows });
  } catch (err) {
    return routeCatch(c, err, {
      code: 'FEEDBACK_QUERY_FAILED',
      status: 503,
      fallback: 'Feedback query failed',
    });
  }
});

// --- Complaints (mounted under /feedback/complaints/*) --------------------

app.post('/complaints', zValidator('json', createComplaintSchema), withSecurityEvents({ action: 'feedback.create', resource: 'feedback', severity: 'info' }, async (c) => {
  const db = getDbFromServices(c);
  if (!db) return dbUnavailable(c);
  const auth = c.get('auth');
  const body = c.req.valid('json');
  try {
    const id = newId('cmp');
    await db.insert(complaintRecords).values({
      id,
      tenantId: auth.tenantId,
      userId: auth.userId,
      subject: body.subject,
      description: body.description,
      category: body.category ?? 'other',
      relatedEntityType: body.relatedEntityType,
      relatedEntityId: body.relatedEntityId,
      priority: body.priority,
      status: 'open',
    });
    return c.json({ success: true, data: { id, status: 'open' } }, 201);
  } catch (err) {
    return routeCatch(c, err, {
      code: 'COMPLAINT_WRITE_FAILED',
      status: 503,
      fallback: 'Complaint write failed',
    });
  }
}));

app.get('/complaints/:id', async (c) => {
  const db = getDbFromServices(c);
  if (!db) return dbUnavailable(c);
  const tenantId = c.get('tenantId');
  const id = c.req.param('id');
  try {
    const [row] = await db
      .select()
      .from(complaintRecords)
      .where(
        and(eq(complaintRecords.tenantId, tenantId), eq(complaintRecords.id, id)),
      )
      .limit(1);
    if (!row) {
      return c.json(
        { success: false, error: { code: 'NOT_FOUND', message: 'Complaint not found' } },
        404,
      );
    }
    return c.json({ success: true, data: row });
  } catch (err) {
    return routeCatch(c, err, {
      code: 'COMPLAINT_QUERY_FAILED',
      status: 503,
      fallback: 'Complaint query failed',
    });
  }
});

app.put(
  '/complaints/:id/resolve',
  zValidator('json', resolveComplaintSchema),
  withSecurityEvents({ action: 'feedback.update', resource: 'feedback', severity: 'info' }, async (c) => {
    const db = getDbFromServices(c);
    if (!db) return dbUnavailable(c);
    const auth = c.get('auth');
    const id = c.req.param('id');
    const body = c.req.valid('json');
    try {
      await db
        .update(complaintRecords)
        .set({
          status: 'resolved',
          resolution: body.resolution,
          resolutionNotes: body.resolutionNotes,
          resolvedBy: auth.userId,
          resolvedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(complaintRecords.tenantId, auth.tenantId),
            eq(complaintRecords.id, id),
          ),
        );
      return c.json({ success: true, data: { id, status: 'resolved' } });
    } catch (err) {
      return routeCatch(c, err, {
        code: 'COMPLAINT_RESOLVE_FAILED',
        status: 503,
        fallback: 'Complaint resolve failed',
      });
    }
  }),
);

// --- Single feedback by id (must come after /complaints/:id) --------------

app.get('/:id', async (c) => {
  const db = getDbFromServices(c);
  if (!db) return dbUnavailable(c);
  const tenantId = c.get('tenantId');
  const id = c.req.param('id');
  try {
    const [row] = await db
      .select()
      .from(feedbackSubmissions)
      .where(
        and(
          eq(feedbackSubmissions.tenantId, tenantId),
          eq(feedbackSubmissions.id, id),
        ),
      )
      .limit(1);
    if (!row) {
      return c.json(
        { success: false, error: { code: 'NOT_FOUND', message: 'Feedback not found' } },
        404,
      );
    }
    return c.json({ success: true, data: row });
  } catch (err) {
    return routeCatch(c, err, {
      code: 'FEEDBACK_QUERY_FAILED',
      status: 503,
      fallback: 'Feedback query failed',
    });
  }
});

export const feedbackRouter = app;
