/**
 * Audit Trail v2 API — Wave 27 Agent C.
 *
 * Cryptographically-verifiable append-only audit log. Exposes the four
 * surfaces a tenant admin needs:
 *
 *   POST /record               → append an entry to the chain
 *   GET  /verify?from&to       → verify hash-chain integrity
 *   GET  /bundle?from&to       → download a signed JSON bundle (regulator export)
 *   GET  /entries?subjectType= → browse entries for a subject
 *
 * All routes require tenant-admin+. The service slot degrades to an
 * in-memory repo when DATABASE_URL is unset, so the surface is always live.
 */

// @ts-nocheck — Hono v4 context typing is open-ended; routers dispatch at runtime.

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { authMiddleware, requireRole } from '../middleware/hono-auth';
import { UserRole } from '../types/user-role';
import { routeCatch } from '../utils/safe-error';
import { AuditTrail } from '@borjie/ai-copilot';

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const ACTOR_KIND_ENUM = z.enum([
  'ai_autonomous',
  'ai_proposal',
  'ai_execution',
  'human_approval',
  'human_override',
  'human_action',
  'system',
]);

const ACTION_CATEGORY_ENUM = z.enum([
  'finance',
  'leasing',
  'maintenance',
  'compliance',
  'communications',
  'marketing',
  'hr',
  'procurement',
  'insurance',
  'legal',
  'tenant_welfare',
  'other',
]);

const RecordSchema = z
  .object({
    actorId: z.string().min(1).nullable().optional(),
    actorKind: ACTOR_KIND_ENUM.optional(),
    actorDisplay: z.string().min(1).max(200).nullable().optional(),
    action: z.string().min(1).max(200),
    actionCategory: ACTION_CATEGORY_ENUM.optional(),
    subjectType: z.string().min(1).max(100).nullable().optional(),
    subjectId: z.string().min(1).max(200).nullable().optional(),
    resourceUri: z.string().min(1).max(500).nullable().optional(),
    details: z.record(z.string(), z.unknown()).optional(),
    decision: z.string().min(1).max(100).optional(),
  })
  .strict();

const VerifyQuerySchema = z
  .object({
    from: z.string().optional(),
    to: z.string().optional(),
    category: ACTION_CATEGORY_ENUM.optional(),
    actorKind: ACTOR_KIND_ENUM.optional(),
  })
  .strict();

const BundleQuerySchema = z
  .object({
    from: z.string().optional(),
    to: z.string().optional(),
    category: ACTION_CATEGORY_ENUM.optional(),
    actorKind: ACTOR_KIND_ENUM.optional(),
    limit: z.string().optional(),
  })
  .strict();

const EntriesQuerySchema = z
  .object({
    subjectType: z.string().min(1).max(100).optional(),
    subjectId: z.string().min(1).max(200).optional(),
    from: z.string().optional(),
    to: z.string().optional(),
    category: ACTION_CATEGORY_ENUM.optional(),
    actorKind: ACTOR_KIND_ENUM.optional(),
    limit: z.string().optional(),
    offset: z.string().optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const app = new Hono();
app.use('*', authMiddleware);
app.use(
  '*',
  requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.TENANT_ADMIN),
);

function slot(c: any): any {
  const services = c.get('services') ?? {};
  return services.auditTrail ?? null;
}

function notConfigured(c: any) {
  return c.json(
    {
      success: false,
      error: {
        code: 'AUDIT_TRAIL_UNAVAILABLE',
        message: 'Audit trail pipeline not configured on this gateway',
      },
    },
    503,
  );
}

function parseDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return undefined;
  return d;
}

function parseIntClamped(
  value: string | undefined,
  fallback: number,
  max: number,
): number {
  if (!value) return fallback;
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, max);
}

// ---------------------------------------------------------------------------
// POST /record — append an entry to the chain.
// ---------------------------------------------------------------------------
app.post('/record', zValidator('json', RecordSchema), async (c: any) => {
  const pipeline = slot(c);
  if (!pipeline?.recorder) return notConfigured(c);
  const auth = c.get('auth');
  const body = c.req.valid('json');

  const actorKind = body.actorKind ?? 'human_action';
  const actionCategory = body.actionCategory ?? 'other';

  try {
    const entry = await pipeline.recorder.record({
      tenantId: auth.tenantId,
      actor: {
        kind: actorKind,
        id: body.actorId ?? auth.userId ?? null,
        display: body.actorDisplay ?? null,
      },
      actionKind: body.action,
      actionCategory,
      subject: {
        entityType: body.subjectType ?? null,
        entityId: body.subjectId ?? null,
        resourceUri: body.resourceUri ?? null,
      },
      ai: {
        attachments: body.details ?? {},
      },
      decision: body.decision,
    });
    return c.json({ success: true, data: entry }, 201);
  } catch (err: any) {
    return routeCatch(c, err, {
      code: 'AUDIT_TRAIL_RECORD_FAILED',
      status: 400,
      fallback: 'Failed to record audit entry',
    });
  }
});

// ---------------------------------------------------------------------------
// GET /verify — verify hash-chain integrity over an optional window.
// ---------------------------------------------------------------------------
app.get('/verify', zValidator('query', VerifyQuerySchema), async (c: any) => {
  const pipeline = slot(c);
  if (!pipeline?.verifier) return notConfigured(c);
  const auth = c.get('auth');
  const q = c.req.valid('query');

  try {
    const result = await pipeline.verifier.verifyRange(auth.tenantId, {
      from: parseDate(q.from),
      to: parseDate(q.to),
      category: q.category,
      actorKind: q.actorKind,
    });
    return c.json({
      success: true,
      data: {
        ok: result.valid,
        entriesChecked: result.entriesChecked,
        firstBrokenEntryId: result.brokenAt ? String(result.brokenAt) : undefined,
        firstValidAt: result.firstValidAt,
        lastValidAt: result.lastValidAt,
        reason: result.error,
      },
    });
  } catch (err: any) {
    return routeCatch(c, err, {
      code: 'AUDIT_TRAIL_VERIFY_FAILED',
      status: 500,
      fallback: 'Failed to verify audit chain',
    });
  }
});

// ---------------------------------------------------------------------------
// GET /bundle — export a signed JSON bundle for the given time range.
// ---------------------------------------------------------------------------
app.get('/bundle', zValidator('query', BundleQuerySchema), async (c: any) => {
  const pipeline = slot(c);
  if (!pipeline?.repo) return notConfigured(c);
  const auth = c.get('auth');
  const q = c.req.valid('query');

  try {
    const bundle = await AuditTrail.exportBundle(
      {
        repo: pipeline.repo,
        signingSecret: pipeline.signingSecret ?? null,
      },
      auth.tenantId,
      {
        from: parseDate(q.from),
        to: parseDate(q.to),
        category: q.category,
        actorKind: q.actorKind,
        limit: q.limit ? parseIntClamped(q.limit, 1000, 10000) : undefined,
      },
    );
    return c.json({ success: true, data: bundle });
  } catch (err: any) {
    return routeCatch(c, err, {
      code: 'AUDIT_TRAIL_BUNDLE_FAILED',
      status: 500,
      fallback: 'Failed to export audit bundle',
    });
  }
});

// ---------------------------------------------------------------------------
// GET /entries — browse entries (optionally filtered by subject).
// ---------------------------------------------------------------------------
app.get('/entries', zValidator('query', EntriesQuerySchema), async (c: any) => {
  const pipeline = slot(c);
  if (!pipeline?.repo) return notConfigured(c);
  const auth = c.get('auth');
  const q = c.req.valid('query');

  try {
    const limit = parseIntClamped(q.limit, 100, 500);
    const offset = q.offset ? Math.max(parseInt(q.offset, 10) || 0, 0) : 0;

    const rows = await pipeline.repo.list(auth.tenantId, {
      from: parseDate(q.from),
      to: parseDate(q.to),
      category: q.category,
      actorKind: q.actorKind,
      limit,
      offset,
    });

    // Subject filter is applied post-list because the repo port intentionally
    // omits subject filters — keeps the SQL index surface small.
    const filtered = rows.filter((r: any) => {
      if (q.subjectType && r.subjectEntityType !== q.subjectType) return false;
      if (q.subjectId && r.subjectEntityId !== q.subjectId) return false;
      return true;
    });

    return c.json({
      success: true,
      data: filtered,
      meta: { limit, offset, count: filtered.length },
    });
  } catch (err: any) {
    return routeCatch(c, err, {
      code: 'AUDIT_TRAIL_LIST_FAILED',
      status: 500,
      fallback: 'Failed to list audit entries',
    });
  }
});

export default app;
