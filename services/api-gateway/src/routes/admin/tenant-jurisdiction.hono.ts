/**
 * /api/v1/admin/tenants/:id/jurisdiction — JC-7 internal-admin
 * jurisdiction override route.
 *
 * Tenants CANNOT self-change their jurisdiction (locked at signup,
 * migration 0149). When a tenant needs to migrate (e.g. legal move,
 * reorganisation), only Borjie internal admin (SUPER_ADMIN / ADMIN /
 * SUPPORT) can re-assign — and the change must traverse a
 * FOUR-EYE flow per CLAUDE.md inviolable.
 *
 * Two-step contract:
 *   1. PROPOSE  POST /admin/tenants/:id/jurisdiction
 *               { newCountryCode, reason, verifiedWith }
 *      → 202 { proposalId, proposedBy }
 *
 *   2. APPROVE  POST /admin/tenants/:id/jurisdiction/:proposalId/approve
 *               { decisionNote? }
 *      The approver MUST be a DIFFERENT user (four-eye). On approval:
 *        - tenants.country (and country_code) flips to newCountryCode.
 *        - tenants.jurisdiction_locked_at refreshes to NOW().
 *        - tenants.jurisdiction_locked_by_user_id flips to the approver.
 *        - Audit chain entry with BOTH admin ids + reason + verifiedWith.
 *        - Cockpit pulse to OWNER ("Your account jurisdiction was
 *          changed from X to Y by Borjie support on D. If this was not
 *          requested, contact support immediately.").
 *      → 200 { applied: true, fromCountry, toCountry, approvedBy }
 *
 *   3. REJECT   POST /admin/tenants/:id/jurisdiction/:proposalId/reject
 *               { decisionNote? }
 *      → 200 { rejected: true }
 *
 *   4. LIST     GET  /admin/tenants/:id/jurisdiction
 *      → { current, pendingProposals[], history[] }
 *
 * Auth: requireRole(SUPER_ADMIN, ADMIN, SUPPORT). The three platform
 * roles all qualify as "Borjie internal admin" per the brief. RLS is
 * BYPASSED (admin elevation) but the audit chain captures the actor.
 */

import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

// ─── Wire-level constants ─────────────────────────────────────────────

/**
 * Allowed target country codes — the curated seed set + the discovery
 * cache promote-able codes. Discovery countries that are NOT promoted
 * yet should be rejected here so an admin doesn't permanently bind a
 * tenant to an unverified jurisdiction. The list is intentionally a
 * superset of the resolver-supported set; expand carefully.
 */
const ALLOWED_TARGET_COUNTRIES = [
  'TZ',
  'KE',
  'UG',
  'NG',
  'ZA',
  'AU',
  'CL',
  'ID',
  'RW',
  'BI',
  'MZ',
  'NA',
  'ZW',
] as const;

// ─── Schemas ──────────────────────────────────────────────────────────

const ProposeBody = z.object({
  newCountryCode: z.enum(ALLOWED_TARGET_COUNTRIES),
  reason: z.string().min(8).max(2000),
  /**
   * Free-form attestation that the admin verified the request with
   * the tenant out-of-band — phone call, in-person, support ticket.
   * Captured verbatim in the audit chain entry.
   */
  verifiedWith: z.string().min(2).max(500),
});

const DecisionBody = z.object({
  decisionNote: z.string().max(2000).optional(),
});

// ─── DI surfaces ──────────────────────────────────────────────────────

export interface ProposalRecord {
  readonly proposalId: string;
  readonly tenantId: string;
  readonly fromCountryCode: string;
  readonly toCountryCode: string;
  readonly reason: string;
  readonly verifiedWith: string;
  readonly proposedByUserId: string;
  readonly proposedAt: string;
  readonly status: 'pending' | 'approved' | 'rejected';
  readonly decidedByUserId?: string;
  readonly decidedAt?: string;
  readonly decisionNote?: string;
}

export interface JurisdictionProposalStore {
  /** Inserts a fresh proposal in `pending` status. */
  create(input: {
    readonly proposalId: string;
    readonly tenantId: string;
    readonly fromCountryCode: string;
    readonly toCountryCode: string;
    readonly reason: string;
    readonly verifiedWith: string;
    readonly proposedByUserId: string;
    readonly proposedAt: string;
  }): Promise<void>;
  /** Returns a single proposal or null. */
  findById(input: {
    readonly tenantId: string;
    readonly proposalId: string;
  }): Promise<ProposalRecord | null>;
  /** Updates the proposal's decision fields atomically. */
  decide(input: {
    readonly tenantId: string;
    readonly proposalId: string;
    readonly status: 'approved' | 'rejected';
    readonly decidedByUserId: string;
    readonly decidedAt: string;
    readonly decisionNote?: string;
  }): Promise<void>;
  /** Lists pending + recent decisions for the tenant. */
  list(tenantId: string): Promise<{
    readonly pending: ReadonlyArray<ProposalRecord>;
    readonly history: ReadonlyArray<ProposalRecord>;
  }>;
}

export interface TenantJurisdictionWriter {
  /** Reads the current country code (and locker) for the tenant. */
  getCurrentJurisdiction(tenantId: string): Promise<{
    readonly countryCode: string;
    readonly lockedAt: string | null;
    readonly lockedByUserId: string | null;
  } | null>;
  /** Flips the tenant's country code + lock metadata. */
  applyJurisdictionChange(input: {
    readonly tenantId: string;
    readonly fromCountryCode: string;
    readonly toCountryCode: string;
    readonly lockedByUserId: string;
    readonly lockedAt: string;
  }): Promise<void>;
}

export interface AdminAuditChainWriter {
  appendJurisdictionChange(input: {
    readonly tenantId: string;
    readonly proposalId: string;
    readonly fromCountryCode: string;
    readonly toCountryCode: string;
    readonly proposedByUserId: string;
    readonly approvedByUserId: string;
    readonly reason: string;
    readonly verifiedWith: string;
  }): Promise<void>;
}

export interface CockpitPulseEmitter {
  /** Notifies the owner that their jurisdiction changed (bilingual). */
  emitJurisdictionChanged(input: {
    readonly tenantId: string;
    readonly fromCountryCode: string;
    readonly toCountryCode: string;
    readonly approvedByUserId: string;
    readonly approvedAt: string;
  }): Promise<void>;
}

export interface AdminContext {
  readonly userId: string;
  readonly role: 'SUPER_ADMIN' | 'ADMIN' | 'SUPPORT';
}

export interface AdminContextResolver {
  /**
   * Resolves the admin context from the incoming request. The default
   * production implementation walks the JWT; tests override with a
   * fake.
   */
  resolve(req: Request): AdminContext | null;
}

export interface AdminLogger {
  info(message: string, meta?: Readonly<Record<string, unknown>>): void;
  warn(message: string, meta?: Readonly<Record<string, unknown>>): void;
  error(message: string, meta?: Readonly<Record<string, unknown>>): void;
}

export interface TenantJurisdictionRouteDeps {
  readonly proposals: JurisdictionProposalStore;
  readonly tenants: TenantJurisdictionWriter;
  readonly auditChain: AdminAuditChainWriter;
  readonly cockpit: CockpitPulseEmitter;
  readonly admin: AdminContextResolver;
  readonly logger: AdminLogger;
  readonly now: () => string;
  readonly newProposalId: () => string;
}

// ─── Router factory ───────────────────────────────────────────────────

export function createAdminTenantJurisdictionRouter(
  deps: TenantJurisdictionRouteDeps,
): Hono {
  const app = new Hono();

  // GET /admin/tenants/:id/jurisdiction
  app.get('/admin/tenants/:id/jurisdiction', async (c) => {
    const admin = deps.admin.resolve(c.req.raw);
    if (!admin) {
      return c.json({ error: 'unauthorized' }, 401);
    }
    const tenantId = c.req.param('id');
    if (!tenantId) {
      return c.json({ error: 'invalid_tenant' }, 400);
    }
    const current = await deps.tenants.getCurrentJurisdiction(tenantId);
    if (!current) {
      return c.json({ error: 'tenant_not_found' }, 404);
    }
    const { pending, history } = await deps.proposals.list(tenantId);
    return c.json(
      {
        current,
        pending,
        history,
      },
      200,
    );
  });

  // POST /admin/tenants/:id/jurisdiction (PROPOSE)
  app.post('/admin/tenants/:id/jurisdiction', async (c) => {
    const admin = deps.admin.resolve(c.req.raw);
    if (!admin) {
      return c.json({ error: 'unauthorized' }, 401);
    }
    const tenantId = c.req.param('id');
    if (!tenantId) {
      return c.json({ error: 'invalid_tenant' }, 400);
    }

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid_body' }, 400);
    }
    const parsed = ProposeBody.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: 'invalid_body', issues: parsed.error.issues },
        400,
      );
    }

    const current = await deps.tenants.getCurrentJurisdiction(tenantId);
    if (!current) {
      return c.json({ error: 'tenant_not_found' }, 404);
    }
    if (current.countryCode === parsed.data.newCountryCode) {
      return c.json(
        {
          error: 'no_change',
          message: `tenant already in ${current.countryCode}`,
        },
        409,
      );
    }

    const proposalId = deps.newProposalId();
    const proposedAt = deps.now();
    try {
      await deps.proposals.create({
        proposalId,
        tenantId,
        fromCountryCode: current.countryCode,
        toCountryCode: parsed.data.newCountryCode,
        reason: parsed.data.reason,
        verifiedWith: parsed.data.verifiedWith,
        proposedByUserId: admin.userId,
        proposedAt,
      });
    } catch (err) {
      deps.logger.error('admin.jurisdiction.propose_failed', {
        tenantId,
        adminId: admin.userId,
        error: err instanceof Error ? err.message : String(err),
      });
      return c.json({ error: 'persist_failed' }, 503);
    }

    return c.json(
      {
        proposalId,
        tenantId,
        fromCountryCode: current.countryCode,
        toCountryCode: parsed.data.newCountryCode,
        proposedBy: admin.userId,
        proposedAt,
        status: 'pending' as const,
      },
      202,
    );
  });

  // POST /admin/tenants/:id/jurisdiction/:proposalId/approve
  app.post(
    '/admin/tenants/:id/jurisdiction/:proposalId/approve',
    async (c) => {
      const admin = deps.admin.resolve(c.req.raw);
      if (!admin) {
        return c.json({ error: 'unauthorized' }, 401);
      }
      const tenantId = c.req.param('id');
      const proposalId = c.req.param('proposalId');
      if (!tenantId || !proposalId) {
        return c.json({ error: 'invalid_params' }, 400);
      }

      let body: unknown = {};
      try {
        const raw = await c.req.text();
        if (raw.trim().length > 0) {
          body = JSON.parse(raw);
        }
      } catch {
        return c.json({ error: 'invalid_body' }, 400);
      }
      const parsed = DecisionBody.safeParse(body);
      if (!parsed.success) {
        return c.json({ error: 'invalid_body' }, 400);
      }

      const proposal = await deps.proposals.findById({ tenantId, proposalId });
      if (!proposal) {
        return c.json({ error: 'proposal_not_found' }, 404);
      }
      if (proposal.status !== 'pending') {
        return c.json(
          { error: 'already_decided', status: proposal.status },
          409,
        );
      }
      // Four-eye invariant per CLAUDE.md — approver MUST differ from
      // proposer. Self-approval would defeat the inviolable rule.
      if (proposal.proposedByUserId === admin.userId) {
        return c.json(
          {
            error: 'four_eye_violation',
            message:
              'jurisdiction change requires a SECOND distinct Borjie internal admin',
          },
          409,
        );
      }

      const decidedAt = deps.now();
      // 1. Apply the country change + refresh the lock metadata.
      try {
        await deps.tenants.applyJurisdictionChange({
          tenantId,
          fromCountryCode: proposal.fromCountryCode,
          toCountryCode: proposal.toCountryCode,
          lockedByUserId: admin.userId,
          lockedAt: decidedAt,
        });
      } catch (err) {
        deps.logger.error('admin.jurisdiction.apply_failed', {
          tenantId,
          proposalId,
          error: err instanceof Error ? err.message : String(err),
        });
        return c.json({ error: 'apply_failed' }, 503);
      }

      // 2. Mark the proposal approved.
      try {
        await deps.proposals.decide({
          tenantId,
          proposalId,
          status: 'approved',
          decidedByUserId: admin.userId,
          decidedAt,
          ...(parsed.data.decisionNote !== undefined && {
            decisionNote: parsed.data.decisionNote,
          }),
        });
      } catch (err) {
        deps.logger.warn('admin.jurisdiction.decide_persist_failed', {
          tenantId,
          proposalId,
          error: err instanceof Error ? err.message : String(err),
        });
        // Continue — the tenant row already flipped; the proposal
        // state is recoverable through the audit chain.
      }

      // 3. Audit chain entry with BOTH ids per JC-7.
      try {
        await deps.auditChain.appendJurisdictionChange({
          tenantId,
          proposalId,
          fromCountryCode: proposal.fromCountryCode,
          toCountryCode: proposal.toCountryCode,
          proposedByUserId: proposal.proposedByUserId,
          approvedByUserId: admin.userId,
          reason: proposal.reason,
          verifiedWith: proposal.verifiedWith,
        });
      } catch (err) {
        deps.logger.warn('admin.jurisdiction.audit_failed', {
          tenantId,
          proposalId,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      // 4. Cockpit pulse to the OWNER per JC-7.
      try {
        await deps.cockpit.emitJurisdictionChanged({
          tenantId,
          fromCountryCode: proposal.fromCountryCode,
          toCountryCode: proposal.toCountryCode,
          approvedByUserId: admin.userId,
          approvedAt: decidedAt,
        });
      } catch (err) {
        deps.logger.warn('admin.jurisdiction.cockpit_pulse_failed', {
          tenantId,
          proposalId,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      return c.json(
        {
          applied: true as const,
          tenantId,
          proposalId,
          fromCountryCode: proposal.fromCountryCode,
          toCountryCode: proposal.toCountryCode,
          proposedBy: proposal.proposedByUserId,
          approvedBy: admin.userId,
          decidedAt,
        },
        200,
      );
    },
  );

  // POST /admin/tenants/:id/jurisdiction/:proposalId/reject
  app.post(
    '/admin/tenants/:id/jurisdiction/:proposalId/reject',
    async (c) => {
      const admin = deps.admin.resolve(c.req.raw);
      if (!admin) {
        return c.json({ error: 'unauthorized' }, 401);
      }
      const tenantId = c.req.param('id');
      const proposalId = c.req.param('proposalId');
      if (!tenantId || !proposalId) {
        return c.json({ error: 'invalid_params' }, 400);
      }
      let body: unknown = {};
      try {
        const raw = await c.req.text();
        if (raw.trim().length > 0) {
          body = JSON.parse(raw);
        }
      } catch {
        return c.json({ error: 'invalid_body' }, 400);
      }
      const parsed = DecisionBody.safeParse(body);
      if (!parsed.success) {
        return c.json({ error: 'invalid_body' }, 400);
      }
      const proposal = await deps.proposals.findById({ tenantId, proposalId });
      if (!proposal) {
        return c.json({ error: 'proposal_not_found' }, 404);
      }
      if (proposal.status !== 'pending') {
        return c.json(
          { error: 'already_decided', status: proposal.status },
          409,
        );
      }
      const decidedAt = deps.now();
      await deps.proposals.decide({
        tenantId,
        proposalId,
        status: 'rejected',
        decidedByUserId: admin.userId,
        decidedAt,
        ...(parsed.data.decisionNote !== undefined && {
          decisionNote: parsed.data.decisionNote,
        }),
      });
      return c.json(
        {
          rejected: true as const,
          tenantId,
          proposalId,
          decidedAt,
          decidedBy: admin.userId,
        },
        200,
      );
    },
  );

  return app;
}

export type AdminTenantJurisdictionRouter = ReturnType<
  typeof createAdminTenantJurisdictionRouter
>;
