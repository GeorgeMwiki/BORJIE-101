/**
 * /api/v1/mining/incidents — safety / environmental / community incidents.
 *
 * Routes:
 *   GET   /             list (filter by siteId, kind, severity, status)
 *   POST  /             create incident report
 *   POST  /:id/close    mark an incident as closed (idempotent)
 *
 * Migrated to `@hono/zod-openapi` (issue #60).
 *
 * Closure flow (migration 0082): the close endpoint stamps closedAt /
 * closedByUserId / closureReason on the row and flips status -> 'closed'.
 * Already-closed rows are no-ops (200 with the existing row). The
 * `withSecurityEvents` wrapper appends a hash-chained audit entry.
 */

import { OpenAPIHono } from '@hono/zod-openapi';
import { randomUUID } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { incidents } from '@borjie/database';
import { withSecurityEvents } from '@borjie/observability';
import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import { publishCockpitEvent } from '../../services/cockpit-events';
import {
  escalateIncident,
  canInvestigate,
  canEscalateToRegulator,
  type IncidentKind,
  type IncidentSeverity,
} from '../../services/safety-incident/escalator';
import {
  incidentsListRoute,
  incidentsCreateRoute,
} from './_openapi/route-defs';

const app = new OpenAPIHono();
app.use('*', authMiddleware);
app.use('*', databaseMiddleware);

app.openapi(incidentsListRoute, async (c) => {
  const { tenantId } = c.get('auth');
  const db = c.get('db');
  const q = c.req.valid('query');
  const limit = Math.min(Number(q.limit ?? 100), 500);
  const conds = [eq(incidents.tenantId, tenantId)];
  if (q.siteId) conds.push(eq(incidents.siteId, q.siteId));
  if (q.kind) conds.push(eq(incidents.kind, q.kind));
  if (q.severity) conds.push(eq(incidents.severity, q.severity));
  if (q.status) conds.push(eq(incidents.status, q.status));
  const rows = await db
    .select()
    .from(incidents)
    .where(and(...conds))
    .orderBy(desc(incidents.occurredAt))
    .limit(limit);
  return c.json({ success: true as const, data: rows }, 200);
});

app.openapi(
  incidentsCreateRoute,
  withSecurityEvents(
    { action: 'mining.incident.create', resource: 'mining.incident', severity: 'warn' },
    async (c) => {
      const { tenantId, userId } = c.get('auth');
      const db = c.get('db');
      const input = c.req.valid('json');
      const [row] = await db
        .insert(incidents)
        .values({
          id: randomUUID(),
          tenantId,
          siteId: input.siteId ?? null,
          kind: input.kind,
          severity: input.severity,
          occurredAt: new Date(input.occurredAt),
          description: input.description ?? null,
          affectedUserIds: input.affectedUserIds ?? [],
          fatalities: input.fatalities,
          injuries: input.injuries,
          location: input.location ?? null,
          status: 'open',
          rootCause: input.rootCause ?? null,
          correctiveActions: input.correctiveActions ?? [],
          reportedByUserId: userId,
          photos: input.photos ?? [],
          evidenceIds: input.evidenceIds ?? [],
          attributes: {},
          createdAt: new Date(),
        })
        .returning();
      // RT-1: pulse the owner cockpit + manager mobile within 200 ms.
      // Chain L-C (issue #193): drive the GMG-aligned escalation
      // fan-out — manager always, owner on >= high, admin compliance
      // + regulator draft on >= critical.
      if (row) {
        const escalation = escalateIncident({
          severity: row.severity as IncidentSeverity,
          kind: row.kind as IncidentKind,
        });
        setImmediate(() => {
          try {
            // Owner cockpit pulse only when severity warrants it.
            if (escalation.emitCockpitPulse) {
              publishCockpitEvent({
                kind: 'safety.incident_reported',
                tenantId,
                emittedAt: new Date().toISOString(),
                incidentId: row.id,
                siteId: row.siteId ?? null,
                severity: row.severity as 'low' | 'medium' | 'high' | 'critical',
                reportedBy: userId,
                summary:
                  `${escalation.summary.en} ${(row.description ?? '').slice(0, 200)}`.trim(),
              });
            }
          } catch {
            // bus failures must never leak to the request response.
          }
        });
      }
      return c.json(
        { success: true as const, data: row },
        201,
      );
    },
  ),
);

// ---------------------------------------------------------------------------
// POST /:id/close — terminal closure for an incident.
//
// Idempotent: re-closing a closed incident returns the existing row at
// 200 without mutating closedAt / closedByUserId. Mandatory closure
// reason; rejected on empty.
// ---------------------------------------------------------------------------

const closeBodySchema = z.object({
  closureReason: z.string().min(1).max(2000),
});

app.post(
  '/:id/close',
  withSecurityEvents(
    {
      action: 'mining.incident.close',
      resource: 'mining.incident',
      severity: 'warn',
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (c: any) => {
      const { tenantId, userId } = c.get('auth');
      const db = c.get('db');
      const id = c.req.param('id');
      if (!id) {
        return c.json(
          {
            success: false as const,
            error: { code: 'BAD_REQUEST', message: 'id required' },
          },
          400,
        );
      }
      const body = await c.req.json().catch(() => null);
      const parsed = closeBodySchema.safeParse(body);
      if (!parsed.success) {
        return c.json(
          {
            success: false as const,
            error: {
              code: 'VALIDATION_ERROR',
              message: 'closureReason is required',
            },
          },
          400,
        );
      }

      const [existing] = await db
        .select()
        .from(incidents)
        .where(and(eq(incidents.id, id), eq(incidents.tenantId, tenantId)))
        .limit(1);

      if (!existing) {
        return c.json(
          {
            success: false as const,
            error: { code: 'NOT_FOUND', message: 'Incident not found' },
          },
          404,
        );
      }

      // Idempotent: already closed — return existing row, no mutation.
      if (existing.status === 'closed') {
        return c.json({ success: true as const, data: existing }, 200);
      }

      const now = new Date();
      const [updated] = await db
        .update(incidents)
        .set({
          status: 'closed',
          closedAt: now,
          closedByUserId: userId,
          closureReason: parsed.data.closureReason,
        })
        .where(and(eq(incidents.id, id), eq(incidents.tenantId, tenantId)))
        .returning();

      return c.json({ success: true as const, data: updated }, 200);
    },
  ),
);

// ---------------------------------------------------------------------------
// POST /:id/investigate — manager / owner records root_cause +
// corrective_actions. Chain L-C (issue #193).
// ---------------------------------------------------------------------------

const investigateBodySchema = z.object({
  rootCause: z.string().min(1).max(4000),
  correctiveActions: z
    .array(
      z.object({
        action: z.string().min(1).max(500),
        owner: z.string().max(200).optional(),
        dueAt: z.string().datetime().optional(),
      }),
    )
    .min(1)
    .max(20),
});

app.post(
  '/:id/investigate',
  withSecurityEvents(
    {
      action: 'mining.incident.investigate',
      resource: 'mining.incident',
      severity: 'warn',
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (c: any) => {
      const { tenantId, userId, role } = c.get('auth');
      if (!canInvestigate(role)) {
        return c.json(
          {
            success: false as const,
            error: {
              code: 'FORBIDDEN',
              message:
                'Only managers / owners / admins may investigate incidents',
            },
          },
          403,
        );
      }
      const db = c.get('db');
      const id = c.req.param('id');
      const body = await c.req.json().catch(() => null);
      const parsed = investigateBodySchema.safeParse(body);
      if (!parsed.success) {
        return c.json(
          {
            success: false as const,
            error: {
              code: 'VALIDATION_ERROR',
              issues: parsed.error.issues,
            },
          },
          400,
        );
      }

      const [existing] = await db
        .select()
        .from(incidents)
        .where(and(eq(incidents.id, id), eq(incidents.tenantId, tenantId)))
        .limit(1);
      if (!existing) {
        return c.json(
          {
            success: false as const,
            error: { code: 'NOT_FOUND', message: 'Incident not found' },
          },
          404,
        );
      }
      if (existing.status === 'closed') {
        return c.json(
          {
            success: false as const,
            error: {
              code: 'INVALID_STATE',
              message: 'Cannot investigate a closed incident',
            },
          },
          409,
        );
      }

      const [updated] = await db
        .update(incidents)
        .set({
          status: 'under_investigation',
          rootCause: parsed.data.rootCause,
          correctiveActions: parsed.data.correctiveActions,
        })
        .where(and(eq(incidents.id, id), eq(incidents.tenantId, tenantId)))
        .returning();

      // Owner cockpit pulse — manager has started the investigation.
      try {
        publishCockpitEvent({
          kind: 'manager.approved',
          tenantId,
          emittedAt: new Date().toISOString(),
          approvalId: id,
          subject: `incident:${id}`,
          approvedBy: userId,
          decision: 'approve',
        });
      } catch {
        // bus failures must never leak to the request response.
      }

      return c.json({ success: true as const, data: updated }, 200);
    },
  ),
);

// ---------------------------------------------------------------------------
// POST /:id/escalate-regulator — owner / admin escalates a critical
// incident to a regulator. Stamps status='escalated_to_OSHA' (the
// existing schema enum) and emits an incident.escalated pulse so the
// admin compliance officer can pick up the filing draft. Chain L-C.
// ---------------------------------------------------------------------------

const escalateBodySchema = z.object({
  regulator: z.enum(['osha-tz', 'nemc', 'pccb', 'mining-commission']),
  reason: z.string().min(1).max(2000),
});

app.post(
  '/:id/escalate-regulator',
  withSecurityEvents(
    {
      action: 'mining.incident.escalate_regulator',
      resource: 'mining.incident',
      severity: 'warn',
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (c: any) => {
      const { tenantId, userId, role } = c.get('auth');
      if (!canEscalateToRegulator(role)) {
        return c.json(
          {
            success: false as const,
            error: {
              code: 'FORBIDDEN',
              message: 'Only owners / admins may escalate to a regulator',
            },
          },
          403,
        );
      }
      const db = c.get('db');
      const id = c.req.param('id');
      const body = await c.req.json().catch(() => null);
      const parsed = escalateBodySchema.safeParse(body);
      if (!parsed.success) {
        return c.json(
          {
            success: false as const,
            error: {
              code: 'VALIDATION_ERROR',
              issues: parsed.error.issues,
            },
          },
          400,
        );
      }

      const [existing] = await db
        .select()
        .from(incidents)
        .where(and(eq(incidents.id, id), eq(incidents.tenantId, tenantId)))
        .limit(1);
      if (!existing) {
        return c.json(
          {
            success: false as const,
            error: { code: 'NOT_FOUND', message: 'Incident not found' },
          },
          404,
        );
      }
      if (existing.status === 'escalated_to_OSHA') {
        return c.json(
          { success: true as const, data: existing, meta: { idempotent: true } },
          200,
        );
      }

      const [updated] = await db
        .update(incidents)
        .set({
          status: 'escalated_to_OSHA',
          attributes: {
            ...(existing.attributes as Record<string, unknown>),
            escalatedRegulator: parsed.data.regulator,
            escalationReason: parsed.data.reason,
            escalatedByUserId: userId,
            escalatedAt: new Date().toISOString(),
          },
        })
        .where(and(eq(incidents.id, id), eq(incidents.tenantId, tenantId)))
        .returning();

      // Cockpit + admin compliance pulse.
      try {
        publishCockpitEvent({
          kind: 'incident.escalated',
          tenantId,
          emittedAt: new Date().toISOString(),
          incidentId: id,
          fromLevel: existing.status,
          toLevel: 'regulator',
          escalatedBy: userId,
        });
      } catch {
        // bus failures must never leak to the request response.
      }

      return c.json({ success: true as const, data: updated }, 200);
    },
  ),
);

export const miningIncidentsRouter = app;
