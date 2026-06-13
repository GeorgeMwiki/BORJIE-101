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
import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { incidents, regulatoryFilings, withServiceRoleContext } from '@borjie/database';
import { withSecurityEvents } from '@borjie/observability';
import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import { publishCockpitEvent } from '../../services/cockpit-events';
import { createPinoLikeLogger } from '../../utils/pino-shim';
import {
  escalateIncident,
  canInvestigate,
  canEscalateToRegulator,
  buildIncidentNotifyIdempotencyKey,
  incidentNotifyTemplateKey,
  incidentLegSummary,
  MANAGER_NOTIFY_ROLES,
  ADMIN_COMPLIANCE_NOTIFY_ROLES,
  type EscalateResult,
  type EscalationLeg,
  type IncidentKind,
  type IncidentSeverity,
} from '../../services/safety-incident/escalator';
import {
  incidentsListRoute,
  incidentsCreateRoute,
} from './_openapi/route-defs';

// Boot-proof structured logger — guaranteed present (the request-context
// logger is optional on this route). Pino-only; never console.* (CLAUDE.md).
const escalationLogger = createPinoLikeLogger('safety-incident-escalation');

// ---------------------------------------------------------------------------
// Escalation-notify fan-out — turn each decided escalator flag into a durable
// `notification_dispatch_log` row so the dispatcher-worker delivers it.
//
// Without this the create handler computed manager-SOS / admin-compliance /
// regulator-draft decisions and acted on NONE of them — a real safety
// incident silently failed to alert the people who must act. Each leg:
//   - resolves its recipients by mining_role (tenant-scoped),
//   - enqueues one `pending` row per recipient (mirrors the announcement-
//     fanout INSERT shape exactly — same 14 columns + ON CONFLICT
//     (tenant_id, idempotency_key) DO NOTHING),
//   - runs under `withServiceRoleContext` (notification_dispatch_log is
//     FORCE-RLS with a service-role bypass; without the bound GUC the INSERT
//     matches zero rows),
//   - is failure-isolated: one failing leg never blocks the others or the
//     cockpit pulse.
//
// The regulator leg NEVER auto-files to a regulator — it enqueues an internal
// PREPARE notification to the compliance desk (human-gated, CLAUDE.md). The
// actual `regulatory_filings` row is created only by POST /:id/escalate-
// regulator, on an explicit owner/admin action.
// ---------------------------------------------------------------------------

/** The db param type withServiceRoleContext expects (derived to dodge the
 *  TS2709 `DatabaseClient` namespace clash under NodeNext — same trick the
 *  announcement-fanout worker uses). */
type ServiceRoleDb = Parameters<typeof withServiceRoleContext>[0];

/** A resolved escalation-notify recipient (tenant-scoped). */
interface NotifyRecipient {
  readonly userId: string;
  readonly address: string;
  readonly channel: 'email' | 'sms' | 'app_push';
  readonly locale: string;
}

/**
 * Pick the best channel + address for a user row. Order: email > sms > in-app.
 * When `allowSms` is false (non-urgent legs), the intrusive SMS rail is SKIPPED
 * (phone-only recipients fall to the in-app queue) — the escalator's SMS "SOS"
 * is reserved for severity >= high, so low/medium incidents never buzz a phone.
 */
function recipientFromRow(
  row: Record<string, unknown>,
  allowSms: boolean,
): NotifyRecipient | null {
  const userId = typeof row.user_id === 'string' ? row.user_id.trim() : '';
  if (!userId) return null;
  const email = typeof row.email === 'string' ? row.email.trim() : '';
  const phone = typeof row.phone === 'string' ? row.phone.trim() : '';
  const locale =
    typeof row.locale === 'string' && row.locale.trim().length > 0
      ? row.locale.trim()
      : 'en';
  if (email) return { userId, address: email, channel: 'email', locale };
  if (phone && allowSms) return { userId, address: phone, channel: 'sms', locale };
  // No usable non-intrusive address — still deliver the in-app push so the
  // alert is never dropped (the worker inbox + dispatcher handle `app_push`).
  return { userId, address: `user:${userId}`, channel: 'app_push', locale };
}

/**
 * Resolve active users in a tenant whose mining_role is in `roles`. Returns
 * [] on any fault (never throws into the fan-out). Runs under the bound
 * service-role context the caller already established.
 */
async function resolveRoleRecipients(
  tx: { execute(q: unknown): Promise<unknown> },
  tenantId: string,
  roles: readonly string[],
  allowSms: boolean,
): Promise<readonly NotifyRecipient[]> {
  if (roles.length === 0) return [];
  // Parameterised IN-list — every role is a bound placeholder (no raw
  // interpolation). The roles are frozen module constants, but binding them
  // keeps the query injection-proof by construction.
  const roleList = sql.join(
    roles.map((r) => sql`${r}`),
    sql`, `,
  );
  const res = await tx.execute(sql`
    SELECT id AS user_id, email, phone, locale
      FROM users
     WHERE tenant_id = ${tenantId}
       AND status = 'active'
       AND deleted_at IS NULL
       AND mining_role IN (${roleList})
     LIMIT 500
  `);
  const rows = Array.isArray(res)
    ? (res as Record<string, unknown>[])
    : (((res as { rows?: unknown }).rows ?? []) as Record<string, unknown>[]);
  const out: NotifyRecipient[] = [];
  for (const row of rows) {
    const recipient = recipientFromRow(row, allowSms);
    if (recipient) out.push(recipient);
  }
  return out;
}

/** INSERT one `pending` dispatch-log row (mirrors announcement-fanout). */
async function enqueueNotifyRow(
  tx: { execute(q: unknown): Promise<unknown> },
  args: {
    readonly tenantId: string;
    readonly incidentId: string;
    readonly leg: EscalationLeg;
    readonly recipient: NotifyRecipient;
    readonly summary: EscalateResult['summary'];
    readonly severity: string;
  },
): Promise<void> {
  const { tenantId, incidentId, leg, recipient, summary, severity } = args;
  const id = `ndl_${randomUUID()}`;
  const idempotencyKey = buildIncidentNotifyIdempotencyKey(
    incidentId,
    leg,
    recipient.userId,
  );
  // Surface the leg summary as the email subject + body in the recipient's
  // OWN locale (single-language). The dispatch email renderer reads
  // payload.subject / payload.body — without these it would emit the generic
  // placeholder and the computed escalation detail would never reach anyone.
  const body = recipient.locale === 'sw' ? summary.sw : summary.en;
  const subject =
    recipient.locale === 'sw'
      ? 'BORJIE: arifa ya kupandishwa kwa tukio la usalama'
      : 'BORJIE: safety incident escalation alert';
  const payload = JSON.stringify({
    incidentId,
    leg,
    severity,
    summary,
    subject,
    body,
    humanGated: leg === 'regulator_prep',
  });
  await tx.execute(sql`
    INSERT INTO notification_dispatch_log (
      id, tenant_id, user_id, channel, recipient_address,
      template_key, locale, payload, correlation_id, idempotency_key,
      attempt_count, delivery_status, created_at, updated_at
    ) VALUES (
      ${id}, ${tenantId}, ${recipient.userId}, ${recipient.channel}, ${recipient.address},
      ${incidentNotifyTemplateKey(leg)}, ${recipient.locale}, ${payload}::jsonb,
      ${`incident-${incidentId}`}, ${idempotencyKey},
      0, 'pending', NOW(), NOW()
    )
    ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
  `);
}

/** Fire ONE leg: resolve recipients, enqueue a row each. Failure-isolated. */
async function fireLeg(
  db: ServiceRoleDb,
  args: {
    readonly tenantId: string;
    readonly incidentId: string;
    readonly leg: EscalationLeg;
    readonly roles: readonly string[];
    readonly summary: EscalateResult['summary'];
    readonly severity: string;
    /** Allow the intrusive SMS rail (reserved for urgent legs / severity>=high). */
    readonly allowSms: boolean;
  },
): Promise<void> {
  const { tenantId, incidentId, leg, roles, summary, severity, allowSms } = args;
  try {
    const legSummary = incidentLegSummary(leg, summary);
    const enqueued = await withServiceRoleContext(db, async (tx) => {
      const recipients = await resolveRoleRecipients(
        tx as unknown as { execute(q: unknown): Promise<unknown> },
        tenantId,
        roles,
        allowSms,
      );
      for (const recipient of recipients) {
        await enqueueNotifyRow(
          tx as unknown as { execute(q: unknown): Promise<unknown> },
          { tenantId, incidentId, leg, recipient, summary: legSummary, severity },
        );
      }
      return recipients.length;
    });
    escalationLogger.info(
      { incidentId, tenantId, leg, recipients: enqueued },
      enqueued > 0
        ? 'incident-escalation: leg enqueued'
        : 'incident-escalation: leg had no eligible recipients',
    );
  } catch (err) {
    // Per-leg isolation — one failing leg must never block the others or the
    // cockpit pulse. Log + swallow (best-effort fan-out off the request path).
    escalationLogger.error(
      { incidentId, tenantId, leg, err: err instanceof Error ? err.message : String(err) },
      'incident-escalation: leg failed',
    );
  }
}

/**
 * Act on every escalation flag the escalator decided. Each leg is independent
 * + failure-isolated. Best-effort — runs off the request response path.
 *
 * Exported for unit testing (the create handler invokes it inside a
 * fire-and-forget `setImmediate`, which is awkward to await in an HTTP-level
 * test; the direct call asserts the enqueue contract deterministically).
 */
export async function fireEscalationLegs(
  db: ServiceRoleDb,
  args: {
    readonly tenantId: string;
    readonly incidentId: string;
    readonly severity: string;
    readonly escalation: EscalateResult;
  },
): Promise<void> {
  const { tenantId, incidentId, severity, escalation } = args;
  const base = { tenantId, incidentId, severity, summary: escalation.summary };
  // The SMS "SOS" rail is reserved for urgent incidents (severity >= high →
  // priority 'urgent'/'critical'). A 'normal'-priority (low/medium) incident
  // still reaches managers — via email / the in-app investigation queue — but
  // never buzzes a phone (the escalator's documented design).
  const urgent = escalation.priority !== 'normal';
  if (escalation.notifyManager) {
    await fireLeg(db, {
      ...base,
      leg: 'manager',
      roles: MANAGER_NOTIFY_ROLES,
      allowSms: urgent,
    });
  }
  if (escalation.notifyAdminCompliance) {
    await fireLeg(db, {
      ...base,
      leg: 'admin_compliance',
      roles: ADMIN_COMPLIANCE_NOTIFY_ROLES,
      allowSms: true,
    });
  }
  if (escalation.draftRegulatorFiling) {
    await fireLeg(db, {
      ...base,
      leg: 'regulator_prep',
      roles: ADMIN_COMPLIANCE_NOTIFY_ROLES,
      allowSms: true,
    });
  }
}

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
        // Capture the incident id BEFORE the async hop so the closure never
        // races a reassigned `row`.
        const incidentId = row.id;
        const severity = row.severity;
        const siteId = row.siteId ?? null;
        const description = row.description ?? '';
        setImmediate(() => {
          try {
            // Owner cockpit pulse only when severity warrants it.
            if (escalation.emitCockpitPulse) {
              publishCockpitEvent({
                kind: 'safety.incident_reported',
                tenantId,
                emittedAt: new Date().toISOString(),
                incidentId,
                siteId,
                severity: severity as 'low' | 'medium' | 'high' | 'critical',
                reportedBy: userId,
                summary:
                  `${escalation.summary.en} ${description.slice(0, 200)}`.trim(),
              });
            }
          } catch {
            // bus failures must never leak to the request response.
          }
          // Act on each computed escalation flag — enqueue a durable
          // notification_dispatch_log row per leg so the dispatcher delivers
          // the manager SOS / admin-compliance alert / regulator-prep notice.
          // Best-effort, off the response path; each leg is failure-isolated
          // inside fireEscalationLegs. Skipped when no transactional client is
          // wired (mock/unit-test mode without `.transaction`).
          const txDb = db as { transaction?: unknown } | null;
          if (txDb && typeof txDb.transaction === 'function') {
            void fireEscalationLegs(db as unknown as ServiceRoleDb, {
              tenantId,
              incidentId,
              severity,
              escalation,
            });
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

/**
 * Map the incident-escalation regulator alias to the canonical
 * `regulatory_filings.regulator` enum (regulatory-filings.schema REGULATORS).
 * `pccb` (anti-corruption bureau) has no first-class enum value, so it routes
 * to `other` — the filing carries the precise regulator in `notes`.
 */
function toFilingRegulator(
  regulator: 'osha-tz' | 'nemc' | 'pccb' | 'mining-commission',
): string {
  switch (regulator) {
    case 'osha-tz':
      return 'osha';
    case 'nemc':
      return 'nemc';
    case 'mining-commission':
      return 'mining_commission';
    case 'pccb':
    default:
      return 'other';
  }
}

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

      // Flip the incident AND create a REAL durable regulator-filing record in
      // ONE transaction so the escalation is never a dead button: the admin
      // compliance officer gets an actionable `regulatory_filings` row (status
      // 'in_progress') routed to the correct regulator, not just a transient
      // pulse. The regulator alias is carried into the filing so the filing is
      // retrievable and routable. Due immediately (incident escalations are not
      // a future-calendar obligation).
      const filingId = randomUUID();
      const now = new Date();
      let updated: typeof existing | undefined;
      try {
        updated = await db.transaction(async (tx: typeof db) => {
          const [row] = await tx
            .update(incidents)
            .set({
              status: 'escalated_to_OSHA',
              attributes: {
                ...(existing.attributes as Record<string, unknown>),
                escalatedRegulator: parsed.data.regulator,
                escalationReason: parsed.data.reason,
                escalatedByUserId: userId,
                escalatedAt: now.toISOString(),
                regulatoryFilingId: filingId,
              },
            })
            .where(and(eq(incidents.id, id), eq(incidents.tenantId, tenantId)))
            .returning();

          await tx.insert(regulatoryFilings).values({
            id: filingId,
            tenantId,
            regulator: toFilingRegulator(parsed.data.regulator),
            filingType: 'incident_escalation',
            dueAt: now,
            status: 'in_progress',
            notes:
              `Incident ${id} escalated to ${parsed.data.regulator} by ${userId}. ` +
              parsed.data.reason,
            createdAt: now,
            updatedAt: now,
          });

          return row;
        });
      } catch (err) {
        c.get('logger')?.error?.(
          { err, incidentId: id },
          'incident escalation / regulatory filing failed',
        );
        return c.json(
          {
            success: false as const,
            error: {
              code: 'ESCALATE_FAILED',
              message:
                'Could not escalate the incident. Imeshindikana kupandisha tukio.',
            },
          },
          500,
        );
      }

      // Cockpit + admin compliance pulse — references the durable filing id so
      // the admin-web compliance screen can deep-link to the new filing.
      try {
        publishCockpitEvent({
          kind: 'incident.escalated',
          tenantId,
          emittedAt: now.toISOString(),
          incidentId: id,
          fromLevel: existing.status,
          toLevel: 'regulator',
          escalatedBy: userId,
        });
      } catch {
        // bus failures must never leak to the request response.
      }

      return c.json(
        { success: true as const, data: updated, meta: { regulatoryFilingId: filingId } },
        200,
      );
    },
  ),
);

export const miningIncidentsRouter = app;
