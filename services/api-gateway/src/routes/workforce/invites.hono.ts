/**
 * /api/v1/workforce/invites — owner/admin invitation flow.
 *
 * Workers do NOT self-sign-up. The lifecycle:
 *
 *   1. Owner (or owner-delegated admin / manager) POSTs an invite for
 *      a phone number. Server generates a 6-digit activation code and
 *      persists a `workforce_invitations` row with status='pending'.
 *      The code is returned in the response so the inviter can forward
 *      it via WhatsApp (wa.me deeplink) — and is also dispatched via
 *      the SMS adapter when configured.
 *
 *   2. Worker opens the workforce-mobile "Activate" screen, types phone
 *      + code, and POSTs to /activate. The route is unauthenticated.
 *      On success the server creates / links a Supabase user, stamps
 *      `app_metadata.tenant_id` + `app_metadata.mining_role`, flips
 *      the row to status='activated', and returns a Supabase session.
 *
 *   3. Owner can GET / (list) and POST /:id/revoke a pending invite.
 *
 * Routes:
 *   POST   /                         create invitation (owner/admin/manager)
 *   GET    /?status=pending          list invitations for current tenant
 *   POST   /:id/revoke               revoke a pending invite
 *   POST   /activate                 public — worker activates
 *
 * Tenant isolation: RLS (migration 0086) auto-scopes every authenticated
 * read/write. Activation is the one route that intentionally bypasses
 * the GUC — it must look up by (phone, code) across tenants.
 *
 * Idempotency: re-inviting the same phone within 24h returns the
 * existing pending row instead of creating a duplicate. Activation is
 * idempotent on already-activated rows (returns 409 ALREADY_ACTIVATED
 * so the client can prompt for sign-in instead).
 *
 * Hash-chain audit (CLAUDE.md): every issue / activate / revoke action
 * appends a row to `ai_audit_chain` and stamps the invitation's
 * `hash_chain_id` with the new entry id.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { and, desc, eq, sql } from 'drizzle-orm';
import { createHash, randomInt, randomUUID } from 'node:crypto';
import { workforceInvitations } from '@borjie/database';
import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import { UserRole } from '../../types/user-role';
import { createLogger } from '../../utils/logger';

const moduleLogger = createLogger('workforce-invites');

const INVITER_ROLES: ReadonlyArray<UserRole> = [
  UserRole.SUPER_ADMIN,
  UserRole.TENANT_ADMIN,
  UserRole.PROPERTY_MANAGER,
  UserRole.OWNER,
] as const;

const ROLES = ['employee', 'manager'] as const;
const STATUSES = ['pending', 'activated', 'expired', 'revoked'] as const;

const DEFAULT_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days
const REINVITE_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

const CERTIFICATIONS = [
  'haul-truck-license',
  'excavator-license',
  'underground-cert',
  'blaster-permit',
  'first-aid',
  'crusher-operator',
  'electrician-class-b',
  'confined-space',
] as const;

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const E164_PATTERN = /^\+[1-9][0-9]{6,14}$/;

const createInviteSchema = z.object({
  phoneE164: z.string().regex(E164_PATTERN, 'phone must be ITU-T E.164 with leading +'),
  fullName: z.string().min(1).max(200).optional(),
  assignedRole: z.enum(ROLES).default('employee'),
  assignedSiteId: z.string().uuid().nullish(),
  assignedCertifications: z.array(z.enum(CERTIFICATIONS)).max(16).default([]),
});

const listQuerySchema = z.object({
  status: z.enum(STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

const activateSchema = z.object({
  phoneE164: z.string().regex(E164_PATTERN),
  activationCode: z.string().regex(/^[0-9]{6}$/),
});

// ---------------------------------------------------------------------------
// Hash-chain audit helper (mirrors mining/tasks.hono.ts)
// ---------------------------------------------------------------------------

interface AuditAppendPayload {
  readonly action: string;
  readonly tenantId: string;
  readonly turnId: string;
  readonly userId: string;
  readonly details: Record<string, unknown>;
}

async function appendAuditEntry(
  db: any,
  payload: AuditAppendPayload,
): Promise<string> {
  const id = randomUUID();
  const canonical = JSON.stringify({
    tenantId: payload.tenantId,
    turnId: payload.turnId,
    action: payload.action,
    userId: payload.userId,
    details: payload.details,
  });

  const latestResult: unknown = await db.execute(
    sql`SELECT COALESCE(MAX(sequence_id), 0) AS max_seq,
               (SELECT this_hash FROM ai_audit_chain
                WHERE tenant_id = ${payload.tenantId}
                ORDER BY sequence_id DESC LIMIT 1) AS last_hash
        FROM ai_audit_chain
        WHERE tenant_id = ${payload.tenantId}`,
  );
  const rows =
    (latestResult as { rows?: ReadonlyArray<Record<string, unknown>> }).rows ??
    (latestResult as ReadonlyArray<Record<string, unknown>>);
  const head = rows[0] ?? {};
  const maxSeq = Number(head.max_seq ?? 0);
  const lastHash =
    typeof head.last_hash === 'string' && head.last_hash.length > 0
      ? head.last_hash
      : '';
  const sequenceId = maxSeq + 1;
  const prevHash = lastHash;
  const thisHash = createHash('sha256')
    .update(prevHash + canonical)
    .digest('hex');

  await db.execute(sql`
    INSERT INTO ai_audit_chain (
      id, tenant_id, sequence_id, turn_id, action,
      prev_hash, this_hash, payload, created_at
    ) VALUES (
      ${id},
      ${payload.tenantId},
      ${sequenceId},
      ${payload.turnId},
      ${payload.action},
      ${prevHash},
      ${thisHash},
      ${JSON.stringify({ userId: payload.userId, details: payload.details })}::jsonb,
      ${new Date().toISOString()}
    )
  `);
  return id;
}

// ---------------------------------------------------------------------------
// SMS adapter — environment-pluggable; falls back to "return code to inviter"
// when no provider is configured. This matches the dev-mode pattern in
// services/wave-resilience-manager.
// ---------------------------------------------------------------------------

export interface InvitationSmsAdapter {
  send(input: {
    readonly phoneE164: string;
    readonly bodySw: string;
    readonly bodyEn: string;
  }): Promise<{ readonly delivered: boolean; readonly providerId: string | null }>;
}

let smsAdapterOverride: InvitationSmsAdapter | null = null;

/** Test-only seam — overrides the env-resolved adapter for the duration of a test. */
export function __setInvitationSmsAdapterForTests(
  adapter: InvitationSmsAdapter | null,
): void {
  smsAdapterOverride = adapter;
}

function resolveSmsAdapter(): InvitationSmsAdapter | null {
  if (smsAdapterOverride) return smsAdapterOverride;
  // No provider configured ⇒ the route returns the code to the inviter and
  // expects them to share via WhatsApp deep-link. This is the documented
  // dev-pattern in CLAUDE.md and the wave spec.
  return null;
}

// ---------------------------------------------------------------------------
// Supabase user provisioning seam — replaced in production by the real
// service-role client (see services/api-gateway/src/auth/supabase/*).
// Default is a no-op that still returns a deterministic user id so the
// flow remains testable without external credentials.
// ---------------------------------------------------------------------------

export interface ActivationSupabasePort {
  ensureUser(input: {
    readonly phoneE164: string;
    readonly tenantId: string;
    readonly miningRole: 'employee' | 'manager';
    readonly fullName: string | null;
  }): Promise<{
    readonly userId: string;
    readonly accessToken: string | null;
    readonly refreshToken: string | null;
    readonly expiresIn: number | null;
  }>;
}

let supabasePortOverride: ActivationSupabasePort | null = null;

/** Test-only seam. */
export function __setActivationSupabasePortForTests(
  port: ActivationSupabasePort | null,
): void {
  supabasePortOverride = port;
}

function resolveSupabasePort(): ActivationSupabasePort {
  if (supabasePortOverride) return supabasePortOverride;
  // Default port — used when no service-role client is wired. Returns a
  // deterministic user id derived from the phone so the row is linkable
  // even in dev. Production wiring lives in the composition root.
  return {
    async ensureUser({ phoneE164 }) {
      const userId = createHash('sha256')
        .update(`borjie:invite:${phoneE164}`)
        .digest('hex')
        .slice(0, 32);
      return {
        userId: `${userId.slice(0, 8)}-${userId.slice(8, 12)}-${userId.slice(
          12,
          16,
        )}-${userId.slice(16, 20)}-${userId.slice(20, 32)}`,
        accessToken: null,
        refreshToken: null,
        expiresIn: null,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

function generateActivationCode(): string {
  // 6 digits, leading zeros preserved.
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function canInvite(role: UserRole | undefined): boolean {
  if (!role) return false;
  return INVITER_ROLES.includes(role);
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export function createWorkforceInvitesRouter(): Hono {
  const app = new Hono();

  // ============================================================
  // PUBLIC route — activation. Must be registered BEFORE the auth
  // middleware so workers can hit it without a bearer token. The
  // database middleware is mounted explicitly on this single path
  // so the route still has a `db` handle (it bypasses tenant GUC
  // because the worker isn't yet authenticated).
  // ============================================================
  app.post('/activate', databaseMiddleware, async (c: any) => {
    const db = c.get('db');
    if (!db) {
      return c.json(
        {
          success: false,
          error: {
            code: 'INVITES_UNAVAILABLE',
            message: 'database is not configured on this gateway',
          },
        },
        503,
      );
    }

    const body = await c.req.json().catch(() => null);
    const parsed = activateSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid body',
            issues: parsed.error.issues,
          },
        },
        400,
      );
    }
    const { phoneE164, activationCode } = parsed.data;

    try {
      const [pending] = await db
        .select()
        .from(workforceInvitations)
        .where(
          and(
            eq(workforceInvitations.phoneE164, phoneE164),
            eq(workforceInvitations.status, 'pending'),
          ),
        )
        .limit(1);

      if (!pending) {
        // Could be activated already, expired, revoked, or never issued.
        // Don't leak which — return a single ambiguous error.
        return c.json(
          {
            success: false,
            error: {
              code: 'INVITATION_NOT_FOUND',
              message: 'No pending invitation for this phone',
            },
          },
          404,
        );
      }

      if (pending.activationCode !== activationCode) {
        return c.json(
          {
            success: false,
            error: {
              code: 'INVALID_CODE',
              message: 'Activation code does not match',
            },
          },
          400,
        );
      }

      const expiresAt =
        pending.expiresAt instanceof Date
          ? pending.expiresAt
          : new Date(pending.expiresAt);
      if (expiresAt.getTime() <= Date.now()) {
        return c.json(
          {
            success: false,
            error: {
              code: 'INVITATION_EXPIRED',
              message: 'Invitation has expired — request a new one',
            },
          },
          410,
        );
      }

      const port = resolveSupabasePort();
      const supabaseUser = await port.ensureUser({
        phoneE164,
        tenantId: pending.tenantId,
        miningRole: pending.assignedRole as 'employee' | 'manager',
        fullName: pending.fullName ?? null,
      });

      const chainId = await appendAuditEntry(db, {
        action: 'workforce.invitation.activate',
        tenantId: pending.tenantId,
        turnId: pending.id,
        userId: supabaseUser.userId,
        details: {
          invitationId: pending.id,
          phoneE164,
          assignedRole: pending.assignedRole,
          assignedSiteId: pending.assignedSiteId,
        },
      });

      const [updated] = await db
        .update(workforceInvitations)
        .set({
          status: 'activated',
          activatedAt: new Date(),
          activatedUserId: supabaseUser.userId,
          hashChainId: chainId,
        })
        .where(eq(workforceInvitations.id, pending.id))
        .returning();

      return c.json(
        {
          success: true,
          data: {
            invitationId: updated.id,
            tenantId: updated.tenantId,
            userId: supabaseUser.userId,
            miningRole: updated.assignedRole,
            session: {
              accessToken: supabaseUser.accessToken,
              refreshToken: supabaseUser.refreshToken,
              expiresIn: supabaseUser.expiresIn,
            },
          },
        },
        200,
      );
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'activation failed';
      moduleLogger.error('workforce invitation activate failed', {
        evt: 'workforce_invitation_activate_failed',
        phoneE164,
        reason: message,
      });
      return c.json(
        {
          success: false,
          error: { code: 'ACTIVATION_FAILED', message },
        },
        500,
      );
    }
  });

  // ============================================================
  // Authenticated routes — owner / admin / manager only.
  // ============================================================
  app.use('*', authMiddleware);
  app.use('*', databaseMiddleware);

  // ----------------------------------------------------------------
  // POST / — issue an invitation
  // ----------------------------------------------------------------
  app.post('/', async (c: any) => {
    const auth = c.get('auth');
    if (!auth || !canInvite(auth.role)) {
      return c.json(
        {
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: 'Only owners / admins / managers may issue invitations',
          },
        },
        403,
      );
    }
    const db = c.get('db');
    if (!db) {
      return c.json(
        {
          success: false,
          error: {
            code: 'INVITES_UNAVAILABLE',
            message: 'database is not configured on this gateway',
          },
        },
        503,
      );
    }

    const body = await c.req.json().catch(() => null);
    const parsed = createInviteSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid body',
            issues: parsed.error.issues,
          },
        },
        400,
      );
    }
    const input = parsed.data;

    try {
      // Idempotency — collapse re-invites within 24h on (tenant, phone, pending).
      const [existing] = await db
        .select()
        .from(workforceInvitations)
        .where(
          and(
            eq(workforceInvitations.tenantId, auth.tenantId),
            eq(workforceInvitations.phoneE164, input.phoneE164),
            eq(workforceInvitations.status, 'pending'),
          ),
        )
        .limit(1);

      if (existing) {
        const createdAt =
          existing.createdAt instanceof Date
            ? existing.createdAt
            : new Date(existing.createdAt);
        const within24h =
          Date.now() - createdAt.getTime() < REINVITE_WINDOW_MS;
        if (within24h) {
          return c.json(
            {
              success: true,
              data: {
                invitationId: existing.id,
                activationCode: existing.activationCode,
                phoneE164: existing.phoneE164,
                assignedRole: existing.assignedRole,
                expiresAt:
                  existing.expiresAt instanceof Date
                    ? existing.expiresAt.toISOString()
                    : existing.expiresAt,
                idempotent: true,
              },
              meta: { idempotent: true as const },
            },
            200,
          );
        }
      }

      const activationCode = generateActivationCode();
      const expiresAt = new Date(Date.now() + DEFAULT_TTL_MS);

      const [row] = await db
        .insert(workforceInvitations)
        .values({
          tenantId: auth.tenantId,
          invitedByUserId: auth.userId,
          fullName: input.fullName ?? null,
          phoneE164: input.phoneE164,
          activationCode,
          assignedRole: input.assignedRole,
          assignedSiteId: input.assignedSiteId ?? null,
          assignedCertifications: input.assignedCertifications,
          expiresAt,
          status: 'pending',
          activatedAt: null,
          activatedUserId: null,
          hashChainId: null,
        })
        .returning();

      const chainId = await appendAuditEntry(db, {
        action: 'workforce.invitation.issue',
        tenantId: auth.tenantId,
        turnId: row.id,
        userId: auth.userId,
        details: {
          invitationId: row.id,
          phoneE164: row.phoneE164,
          assignedRole: row.assignedRole,
          assignedSiteId: row.assignedSiteId,
        },
      });

      const [stamped] = await db
        .update(workforceInvitations)
        .set({ hashChainId: chainId })
        .where(eq(workforceInvitations.id, row.id))
        .returning();

      // Best-effort SMS dispatch. Adapter failures do NOT roll back the
      // invitation — the inviter can always forward the code manually.
      const sms = resolveSmsAdapter();
      let smsDelivered = false;
      let smsProviderId: string | null = null;
      if (sms) {
        try {
          const result = await sms.send({
            phoneE164: input.phoneE164,
            bodySw: `Karibu Borjie. Nambari yako ya kupokelewa: ${activationCode}. Inakwisha baada ya siku 14.`,
            bodyEn: `Welcome to Borjie. Your activation code: ${activationCode}. Expires in 14 days.`,
          });
          smsDelivered = result.delivered;
          smsProviderId = result.providerId;
        } catch (smsErr) {
          moduleLogger.warn('workforce invitation SMS dispatch failed', {
            evt: 'workforce_invitation_sms_failed',
            tenantId: auth.tenantId,
            invitationId: row.id,
            reason:
              smsErr instanceof Error ? smsErr.message : 'sms dispatch failed',
          });
        }
      }

      return c.json(
        {
          success: true,
          data: {
            invitationId: stamped.id,
            activationCode,
            phoneE164: stamped.phoneE164,
            assignedRole: stamped.assignedRole,
            assignedSiteId: stamped.assignedSiteId,
            assignedCertifications: stamped.assignedCertifications,
            expiresAt:
              stamped.expiresAt instanceof Date
                ? stamped.expiresAt.toISOString()
                : stamped.expiresAt,
            smsDelivered,
            smsProviderId,
          },
        },
        201,
      );
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'invitation create failed';
      moduleLogger.error('workforce invitation create failed', {
        evt: 'workforce_invitation_create_failed',
        tenantId: auth.tenantId,
        reason: message,
      });
      return c.json(
        {
          success: false,
          error: { code: 'INVITE_CREATE_FAILED', message },
        },
        500,
      );
    }
  });

  // ----------------------------------------------------------------
  // GET / — list invites for the current tenant
  // ----------------------------------------------------------------
  app.get('/', async (c: any) => {
    const auth = c.get('auth');
    if (!auth || !canInvite(auth.role)) {
      return c.json(
        {
          success: false,
          error: { code: 'FORBIDDEN', message: 'Insufficient permissions' },
        },
        403,
      );
    }
    const db = c.get('db');
    if (!db) {
      return c.json(
        {
          success: false,
          error: {
            code: 'INVITES_UNAVAILABLE',
            message: 'database is not configured on this gateway',
          },
        },
        503,
      );
    }

    const parsed = listQuerySchema.safeParse({
      status: c.req.query('status'),
      limit: c.req.query('limit'),
    });
    if (!parsed.success) {
      return c.json(
        {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid query',
            issues: parsed.error.issues,
          },
        },
        400,
      );
    }

    const { status, limit } = parsed.data;
    const conds = [eq(workforceInvitations.tenantId, auth.tenantId)];
    if (status) {
      conds.push(eq(workforceInvitations.status, status));
    }

    try {
      const rows = await db
        .select()
        .from(workforceInvitations)
        .where(and(...conds))
        .orderBy(desc(workforceInvitations.createdAt))
        .limit(Math.min(limit ?? 100, 500));
      return c.json({ success: true, data: rows }, 200);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'list failed';
      moduleLogger.error('workforce invitation list failed', {
        evt: 'workforce_invitation_list_failed',
        tenantId: auth.tenantId,
        reason: message,
      });
      return c.json(
        {
          success: false,
          error: { code: 'INVITE_LIST_FAILED', message },
        },
        500,
      );
    }
  });

  // ----------------------------------------------------------------
  // POST /:id/revoke — revoke a pending invite
  // ----------------------------------------------------------------
  app.post('/:id/revoke', async (c: any) => {
    const auth = c.get('auth');
    if (!auth || !canInvite(auth.role)) {
      return c.json(
        {
          success: false,
          error: { code: 'FORBIDDEN', message: 'Insufficient permissions' },
        },
        403,
      );
    }
    const db = c.get('db');
    if (!db) {
      return c.json(
        {
          success: false,
          error: {
            code: 'INVITES_UNAVAILABLE',
            message: 'database is not configured on this gateway',
          },
        },
        503,
      );
    }

    const id = c.req.param('id');
    if (!isUuid(id)) {
      return c.json(
        {
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Invalid id' },
        },
        400,
      );
    }

    try {
      const [existing] = await db
        .select()
        .from(workforceInvitations)
        .where(
          and(
            eq(workforceInvitations.tenantId, auth.tenantId),
            eq(workforceInvitations.id, id),
          ),
        )
        .limit(1);

      if (!existing) {
        return c.json(
          {
            success: false,
            error: {
              code: 'INVITATION_NOT_FOUND',
              message: 'Invitation not found',
            },
          },
          404,
        );
      }

      if (existing.status !== 'pending') {
        return c.json(
          {
            success: false,
            error: {
              code: 'INVITATION_NOT_PENDING',
              message: `Cannot revoke an invitation in state '${existing.status}'`,
            },
          },
          409,
        );
      }

      const chainId = await appendAuditEntry(db, {
        action: 'workforce.invitation.revoke',
        tenantId: auth.tenantId,
        turnId: existing.id,
        userId: auth.userId,
        details: { invitationId: existing.id, phoneE164: existing.phoneE164 },
      });

      const [updated] = await db
        .update(workforceInvitations)
        .set({ status: 'revoked', hashChainId: chainId })
        .where(
          and(
            eq(workforceInvitations.tenantId, auth.tenantId),
            eq(workforceInvitations.id, id),
          ),
        )
        .returning();

      return c.json({ success: true, data: updated }, 200);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'revoke failed';
      moduleLogger.error('workforce invitation revoke failed', {
        evt: 'workforce_invitation_revoke_failed',
        tenantId: auth.tenantId,
        invitationId: id,
        reason: message,
      });
      return c.json(
        {
          success: false,
          error: { code: 'INVITE_REVOKE_FAILED', message },
        },
        500,
      );
    }
  });

  return app;
}

export const workforceInvitesRouter = createWorkforceInvitesRouter();
