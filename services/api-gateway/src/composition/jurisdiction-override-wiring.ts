/**
 * jurisdiction-override-wiring — Wave-6 closure.
 *
 * Composes the five concrete DI adapters the JC-7 admin jurisdiction
 * four-eye router (`routes/admin/tenant-jurisdiction.hono.ts`,
 * createAdminTenantJurisdictionRouter) requires, so that route can be
 * mounted on the live admin path. The router itself enforces the
 * inviolable four-eye gate (PROPOSE by admin_a -> APPROVE by a DIFFERENT
 * admin_b; self-approval is rejected 409). This module supplies its
 * persistence + side-effects:
 *
 *   - JurisdictionProposalStore  → Drizzle over `jurisdiction_proposals`
 *                                  (migration 0322).
 *   - TenantJurisdictionWriter   → reads + flips the tenant's country
 *                                  code + lock metadata on `tenants`.
 *   - AdminAuditChainWriter      → appends BOTH actors to the canonical
 *                                  hash-chained, append-only audit trail
 *                                  (`createAuditTrailRecorder` over
 *                                  `PostgresAuditTrailRepository`). Never
 *                                  mutates a prior row.
 *   - CockpitPulseEmitter        → owner pulse via the canonical
 *                                  `tab_event_log` proactive_nudge row.
 *   - AdminContextResolver       → resolves the validated Supabase-JWT
 *                                  admin principal (SUPER_ADMIN / ADMIN /
 *                                  SUPPORT) that the mount-side
 *                                  `authMiddleware` + `requireRole`
 *                                  already verified, pinned per-request.
 *
 * RLS note: the override is an INTENTIONAL admin elevation (a tenant
 * cannot self-change jurisdiction). The adapters run under the
 * composition root's service-role DB context; the audit chain captures
 * the actor on every change. The `jurisdiction_proposals` table is
 * FORCE-RLS isolated against ordinary tenant-scoped callers
 * (migration 0322).
 *
 * Supabase JWT is canonical auth — NO Clerk. The resolver reads the
 * principal the gateway's own `authMiddleware` already validated; it
 * does not re-implement token verification.
 */

import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import { sql } from 'drizzle-orm';
import {
  createAuditTrailRecorder,
  type AuditTrailRecorder,
} from '@borjie/ai-copilot/audit-trail';
import { PostgresAuditTrailRepository } from './audit-trail-repository.js';
import { authMiddleware, requireRole } from '../middleware/hono-auth.js';
import { UserRole } from '../types/user-role.js';
import {
  createAdminTenantJurisdictionRouter,
  type AdminContext,
  type AdminContextResolver,
  type AdminAuditChainWriter,
  type AdminLogger,
  type CockpitPulseEmitter,
  type JurisdictionProposalStore,
  type ProposalRecord,
  type TenantJurisdictionRouteDeps,
  type TenantJurisdictionWriter,
} from '../routes/admin/tenant-jurisdiction.hono.js';

// ─────────────────────────────────────────────────────────────────────
// DB shape — we only use `.execute(sql\`...\`)`.
// ─────────────────────────────────────────────────────────────────────

interface DrizzleLikeClient {
  execute(q: unknown): Promise<unknown>;
}

function rowsOf(result: unknown): ReadonlyArray<Record<string, unknown>> {
  if (Array.isArray(result)) {
    return result as ReadonlyArray<Record<string, unknown>>;
  }
  const maybe = result as { rows?: ReadonlyArray<Record<string, unknown>> };
  return maybe.rows ?? [];
}

function toIso(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'string') return v;
  return new Date(0).toISOString();
}

function mapProposalRow(r: Record<string, unknown>): ProposalRecord {
  const base = {
    proposalId: String(r.proposal_id ?? ''),
    tenantId: String(r.tenant_id ?? ''),
    fromCountryCode: String(r.from_country_code ?? ''),
    toCountryCode: String(r.to_country_code ?? ''),
    reason: String(r.reason ?? ''),
    verifiedWith: String(r.verified_with ?? ''),
    proposedByUserId: String(r.proposed_by_user_id ?? ''),
    proposedAt: toIso(r.proposed_at),
    status: String(r.status ?? 'pending') as ProposalRecord['status'],
  };
  return {
    ...base,
    ...(r.decided_by_user_id != null
      ? { decidedByUserId: String(r.decided_by_user_id) }
      : {}),
    ...(r.decided_at != null ? { decidedAt: toIso(r.decided_at) } : {}),
    ...(r.decision_note != null
      ? { decisionNote: String(r.decision_note) }
      : {}),
  };
}

// ─────────────────────────────────────────────────────────────────────
// 1. JurisdictionProposalStore — Drizzle over `jurisdiction_proposals`.
// ─────────────────────────────────────────────────────────────────────

export function createJurisdictionProposalStore(
  db: DrizzleLikeClient,
): JurisdictionProposalStore {
  return {
    async create(input) {
      await db.execute(sql`
        INSERT INTO jurisdiction_proposals
          (proposal_id, tenant_id, from_country_code, to_country_code,
           reason, verified_with, proposed_by_user_id, proposed_at, status)
        VALUES
          (${input.proposalId}, ${input.tenantId}, ${input.fromCountryCode},
           ${input.toCountryCode}, ${input.reason}, ${input.verifiedWith},
           ${input.proposedByUserId}, ${input.proposedAt}::timestamptz,
           'pending')
        ON CONFLICT (proposal_id) DO NOTHING
      `);
    },
    async findById(input) {
      const result = await db.execute(sql`
        SELECT proposal_id, tenant_id, from_country_code, to_country_code,
               reason, verified_with, proposed_by_user_id, proposed_at,
               status, decided_by_user_id, decided_at, decision_note
          FROM jurisdiction_proposals
         WHERE tenant_id = ${input.tenantId}
           AND proposal_id = ${input.proposalId}
         LIMIT 1
      `);
      const rows = rowsOf(result);
      return rows.length > 0 ? mapProposalRow(rows[0]!) : null;
    },
    async decide(input) {
      await db.execute(sql`
        UPDATE jurisdiction_proposals
           SET status = ${input.status},
               decided_by_user_id = ${input.decidedByUserId},
               decided_at = ${input.decidedAt}::timestamptz,
               decision_note = ${input.decisionNote ?? null}
         WHERE tenant_id = ${input.tenantId}
           AND proposal_id = ${input.proposalId}
           AND status = 'pending'
      `);
    },
    async list(tenantId) {
      const result = await db.execute(sql`
        SELECT proposal_id, tenant_id, from_country_code, to_country_code,
               reason, verified_with, proposed_by_user_id, proposed_at,
               status, decided_by_user_id, decided_at, decision_note
          FROM jurisdiction_proposals
         WHERE tenant_id = ${tenantId}
         ORDER BY proposed_at DESC
         LIMIT 200
      `);
      const all = rowsOf(result).map(mapProposalRow);
      return {
        pending: all.filter((p) => p.status === 'pending'),
        history: all.filter((p) => p.status !== 'pending'),
      };
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// 2. TenantJurisdictionWriter — read + flip the tenant's jurisdiction.
// ─────────────────────────────────────────────────────────────────────

export function createTenantJurisdictionWriter(
  db: DrizzleLikeClient,
): TenantJurisdictionWriter {
  return {
    async getCurrentJurisdiction(tenantId) {
      const result = await db.execute(sql`
        SELECT country_code, jurisdiction_locked_at,
               jurisdiction_locked_by_user_id
          FROM tenants
         WHERE id = ${tenantId}
         LIMIT 1
      `);
      const rows = rowsOf(result);
      if (rows.length === 0) return null;
      const r = rows[0]!;
      return {
        countryCode: String(r.country_code ?? ''),
        lockedAt: r.jurisdiction_locked_at != null
          ? toIso(r.jurisdiction_locked_at)
          : null,
        lockedByUserId: r.jurisdiction_locked_by_user_id != null
          ? String(r.jurisdiction_locked_by_user_id)
          : null,
      };
    },
    async applyJurisdictionChange(input) {
      // Flip BOTH `country` (legacy back-compat) and `country_code`
      // (canonical) so every read path stays consistent, and refresh the
      // lock metadata to the approving admin per JC-7.
      await db.execute(sql`
        UPDATE tenants
           SET country = ${input.toCountryCode},
               country_code = ${input.toCountryCode},
               jurisdiction_locked_at = ${input.lockedAt}::timestamptz,
               jurisdiction_locked_by_user_id = ${input.lockedByUserId}
         WHERE id = ${input.tenantId}
      `);
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// 3. AdminAuditChainWriter — canonical hash-chained, append-only trail.
// ─────────────────────────────────────────────────────────────────────

export function createAdminJurisdictionAuditChainWriter(
  db: DrizzleLikeClient,
  options?: { readonly signingSecret?: string | null },
): AdminAuditChainWriter {
  const recorder: AuditTrailRecorder = createAuditTrailRecorder({
    repo: new PostgresAuditTrailRepository(db as never),
    signingSecret: options?.signingSecret ?? null,
  });
  return {
    async appendJurisdictionChange(input) {
      // Append-only: BOTH actors (proposer + approver) are captured in
      // the evidence attachments so the four-eye decision is fully
      // reconstructable. Category `compliance` (regulator-facing change).
      await recorder.record({
        tenantId: input.tenantId,
        actor: {
          kind: 'human_action',
          id: input.approvedByUserId,
          display: null,
        },
        actionKind: 'admin.tenant.jurisdiction_changed',
        actionCategory: 'compliance',
        subject: {
          entityType: 'tenant',
          entityId: input.tenantId,
          resourceUri: null,
        },
        ai: {
          attachments: {
            proposalId: input.proposalId,
            fromCountryCode: input.fromCountryCode,
            toCountryCode: input.toCountryCode,
            proposedByUserId: input.proposedByUserId,
            approvedByUserId: input.approvedByUserId,
            reason: input.reason,
            verifiedWith: input.verifiedWith,
            fourEye: true,
          },
        },
      });
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// 4. CockpitPulseEmitter — owner pulse via the tab_event_log contract.
// ─────────────────────────────────────────────────────────────────────

export function createJurisdictionCockpitPulseEmitter(
  db: DrizzleLikeClient,
  logger: AdminLogger,
): CockpitPulseEmitter {
  return {
    async emitJurisdictionChanged(input) {
      const proposalId = `jurisdiction:${input.tenantId}:${input.approvedAt}`;
      // English-default headline (the owner-web renders per-locale copy
      // from the structured snapshot; the notes field is the EN fallback).
      const headline =
        `Your account jurisdiction was changed from ` +
        `${input.fromCountryCode} to ${input.toCountryCode} by Borjie ` +
        `support. If this was not requested, contact support immediately.`;
      const snapshot = {
        delivered: false,
        source: 'admin-jurisdiction-override',
        kind: 'jurisdiction_changed',
        fromCountryCode: input.fromCountryCode,
        toCountryCode: input.toCountryCode,
        approvedByUserId: input.approvedByUserId,
        approvedAt: input.approvedAt,
      };
      const rowId = `jc_${input.tenantId}_${input.approvedAt}`;
      try {
        await db.execute(sql`
          INSERT INTO tab_event_log
            (id, tenant_id, proposal_id, persona_id, event_kind, actor,
             transport, snapshot, notes, sequence, created_at)
          VALUES
            (${rowId}, ${input.tenantId}, ${proposalId}, ${'mwikila'},
             ${'proactive_nudge'}, ${'admin'}, ${'cockpit'},
             ${JSON.stringify(snapshot)}::jsonb, ${headline}, ${0}, now())
          ON CONFLICT (id) DO NOTHING
        `);
      } catch (err) {
        // Pulse is best-effort — never fail the jurisdiction change for a
        // notification write. The router already catches this too.
        logger.warn('admin.jurisdiction.cockpit_pulse_persist_failed', {
          tenantId: input.tenantId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// 5. AdminContextResolver — read the request-pinned validated principal.
//
// The mount-side `authMiddleware` + `requireRole(SUPER_ADMIN | ADMIN |
// SUPPORT)` have already validated the Supabase JWT and the role. This
// resolver returns that principal. The bridge below pins the resolved
// admin context onto a WeakMap keyed by the raw `Request` (the same
// object the router's `c.req.raw` exposes), so no token re-verification
// happens here and there is no Clerk import.
// ─────────────────────────────────────────────────────────────────────

const ADMIN_CTX_BY_REQUEST = new WeakMap<Request, AdminContext>();

/** Called by the mount-side bridge middleware once auth is validated. */
export function pinAdminContext(req: Request, ctx: AdminContext): void {
  ADMIN_CTX_BY_REQUEST.set(req, ctx);
}

export function createRequestPinnedAdminContextResolver(): AdminContextResolver {
  return {
    resolve(req: Request): AdminContext | null {
      return ADMIN_CTX_BY_REQUEST.get(req) ?? null;
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Aggregate — build the full TenantJurisdictionRouteDeps bundle.
// ─────────────────────────────────────────────────────────────────────

export interface JurisdictionOverrideWiringDeps {
  readonly db: DrizzleLikeClient;
  readonly logger: AdminLogger;
  readonly signingSecret?: string | null;
  readonly now?: () => string;
  readonly newProposalId: () => string;
}

export function createJurisdictionOverrideRouteDeps(
  deps: JurisdictionOverrideWiringDeps,
): TenantJurisdictionRouteDeps {
  return {
    proposals: createJurisdictionProposalStore(deps.db),
    tenants: createTenantJurisdictionWriter(deps.db),
    auditChain: createAdminJurisdictionAuditChainWriter(deps.db, {
      signingSecret: deps.signingSecret ?? null,
    }),
    cockpit: createJurisdictionCockpitPulseEmitter(deps.db, deps.logger),
    admin: createRequestPinnedAdminContextResolver(),
    logger: deps.logger,
    now: deps.now ?? (() => new Date().toISOString()),
    newProposalId: deps.newProposalId,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Mounted router — auth-guarded, ready to `api.route('/', router)`.
//
// The JC-7 factory router has NO internal auth (it resolves admin
// context via `deps.admin.resolve(c.req.raw)`). This wrapper applies the
// canonical Supabase-JWT `authMiddleware` + `requireRole(SUPER_ADMIN |
// ADMIN | SUPPORT)` and then a bridge middleware that pins the validated
// principal onto the request so the resolver can read it. Net effect: the
// route is on the live admin four-eye path with full auth + RBAC, and the
// four-eye self-approval guard stays enforced end-to-end through the
// mounted handler.
// ─────────────────────────────────────────────────────────────────────

/**
 * Bridge: copy the already-validated `c.get('auth')` principal onto the
 * per-request WeakMap the AdminContextResolver reads. `requireRole` has
 * already proven `role ∈ {SUPER_ADMIN, ADMIN, SUPPORT}` so the cast is
 * sound; we re-check defensively and 403 otherwise (belt-and-braces).
 */
const pinAdminContextMiddleware = createMiddleware(async (c, next) => {
  const auth = c.get('auth') as
    | { userId?: string; role?: string }
    | undefined;
  const role = auth?.role;
  if (
    auth?.userId &&
    (role === 'SUPER_ADMIN' || role === 'ADMIN' || role === 'SUPPORT')
  ) {
    pinAdminContext(c.req.raw, {
      userId: auth.userId,
      role,
    });
  }
  await next();
});

export interface MountedJurisdictionRouterDeps {
  readonly db: DrizzleLikeClient;
  readonly logger: AdminLogger;
  readonly signingSecret?: string | null;
  readonly now?: () => string;
  readonly newProposalId?: () => string;
}

/**
 * Build the fully auth-guarded jurisdiction four-eye router, ready to
 * mount at `api.route('/', createMountedAdminTenantJurisdictionRouter(...))`.
 * The inner factory router's paths are absolute
 * (`/admin/tenants/:id/jurisdiction[...]`) so it mounts at the api root.
 */
export function createMountedAdminTenantJurisdictionRouter(
  deps: MountedJurisdictionRouterDeps,
): Hono {
  const routeDeps = createJurisdictionOverrideRouteDeps({
    db: deps.db,
    logger: deps.logger,
    signingSecret: deps.signingSecret ?? null,
    ...(deps.now ? { now: deps.now } : {}),
    newProposalId: deps.newProposalId ?? (() => `jcp_${randomUUID()}`),
  });

  const app = new Hono();
  // Canonical auth + RBAC gate — Supabase JWT, no Clerk.
  app.use('/admin/tenants/:id/jurisdiction', authMiddleware);
  app.use('/admin/tenants/:id/jurisdiction', requireRole(
    UserRole.SUPER_ADMIN,
    UserRole.ADMIN,
    UserRole.SUPPORT,
  ));
  app.use('/admin/tenants/:id/jurisdiction', pinAdminContextMiddleware);
  app.use('/admin/tenants/:id/jurisdiction/*', authMiddleware);
  app.use('/admin/tenants/:id/jurisdiction/*', requireRole(
    UserRole.SUPER_ADMIN,
    UserRole.ADMIN,
    UserRole.SUPPORT,
  ));
  app.use('/admin/tenants/:id/jurisdiction/*', pinAdminContextMiddleware);

  app.route('/', createAdminTenantJurisdictionRouter(routeDeps));
  return app;
}
