/**
 * Contractor / site damage-claim + mine-rehabilitation API routes
 * (migration 0279).
 *
 * Ported from the BossNyumba damage-deduction + conditional-survey routes,
 * retargeted real-estate → mining:
 *
 *   POST   /                                            file a new damage claim
 *   GET    /open                                        list open claims
 *   GET    /:id                                         read a single claim
 *   POST   /:id/respond                                 owner counter / rationale
 *   POST   /:id/settle                                  agree + finalise amount
 *   POST   /rehabilitation-plans/:planId/action-plans/:actionPlanId/approve
 *                                                       approve a remediation
 *                                                       action plan
 *
 * Wired to `DamageClaimRepository` over the request-scoped Drizzle client
 * (`databaseMiddleware`). Tenant isolation is FORCE-RLS on
 * `app.current_tenant_id` plus an explicit WHERE tenant_id in the repo.
 *
 * FK validation: file/respond/settle refuse with a 404 when the site or
 * contractor party does not exist for the tenant BEFORE the FK would throw.
 *
 * Provenance: every WRITE resolves provenance via `resolveProvenance(c, body,
 * { trustedSource: true })` so a chat-originated call (loopback service token)
 * keeps its `via: 'chat'` + session/turn ids and a browser POST stamps
 * `via: 'form'`. The "via Mr. Mwikila" pill reads this envelope.
 *
 * Money: settlement records the agreed amount as STATE only — NO ledger
 * posting fires here (honest-degrade; any posting is a LedgerService step).
 * Amounts are minor-unit integers + an explicit ISO-4217 currency; nothing
 * here hard-codes a currency.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { withSecurityEvents } from '@borjie/observability';

import { authMiddleware } from '../middleware/hono-auth';
import { databaseMiddleware } from '../middleware/database';
import { routeCatch } from '../utils/safe-error';
import { resolveProvenance } from '../services/provenance';
import {
  DamageClaimRepository,
  ClaimStateError,
} from '../composition/damage-claim-repository';

// ─── Schemas ─────────────────────────────────────────────────────────

const DAMAGE_CATEGORIES = [
  'equipment',
  'haul_road',
  'env_buffer',
  'water_source',
  'processing_plant',
  'camp',
  'other',
] as const;

const FileClaimSchema = z.object({
  siteId: z.string().min(1).max(120),
  contractorPartyId: z.string().uuid(),
  sourceEngagementId: z.string().uuid().nullable().optional(),
  damageCategory: z.enum(DAMAGE_CATEGORIES).default('other'),
  claimedAmountMinor: z.number().int().positive(),
  // ISO-4217 — caller resolves the tenant currency upstream. NEVER defaulted
  // here (multi-currency hard rule).
  currency: z.string().trim().length(3),
  rationale: z.string().trim().min(1).max(4000),
  notes: z.string().trim().max(4000).nullable().optional(),
  provenance: z.record(z.string(), z.unknown()).optional(),
});

const RespondSchema = z.object({
  counterProposalMinor: z.number().int().nonnegative().nullable().optional(),
  rationale: z.string().trim().min(1).max(4000),
  provenance: z.record(z.string(), z.unknown()).optional(),
});

const SettleSchema = z.object({
  agreedAmountMinor: z.number().int().nonnegative(),
  notes: z.string().trim().max(4000).nullable().optional(),
  provenance: z.record(z.string(), z.unknown()).optional(),
});

const ApprovePlanSchema = z
  .object({ provenance: z.record(z.string(), z.unknown()).optional() })
  .default({});

const OpenQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(200).default(50),
});

// ─── Helpers ─────────────────────────────────────────────────────────

type AuthShape = { readonly tenantId: string; readonly userId: string };

function notConfigured(c: any) {
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

function notFound(c: any, message: string) {
  return c.json(
    { success: false, error: { code: 'NOT_FOUND', message } },
    404,
  );
}

function stateConflict(c: any, err: ClaimStateError) {
  return c.json(
    { success: false, error: { code: err.code, message: err.message } },
    409,
  );
}

const app = new Hono();
app.use('*', authMiddleware);
app.use('*', databaseMiddleware);

// ─── POST / — file a new claim ───────────────────────────────────────

app.post(
  '/',
  zValidator('json', FileClaimSchema),
  withSecurityEvents(
    {
      action: 'damage-claim.file',
      resource: 'damage-claim',
      severity: 'warning',
    },
    async (c: any) => {
      const db = c.get('db');
      if (!db) return notConfigured(c);
      const auth = c.get('auth') as AuthShape;
      const body = c.req.valid('json');
      try {
        const repo = new DamageClaimRepository(db);
        if (!(await repo.siteExists(body.siteId, auth.tenantId))) {
          return notFound(c, 'Site not found for this tenant');
        }
        if (
          !(await repo.contractorExists(body.contractorPartyId, auth.tenantId))
        ) {
          return notFound(c, 'Contractor party not found for this tenant');
        }
        const provenance = resolveProvenance(c, body, { trustedSource: true });
        const row = await repo.fileClaim({
          tenantId: auth.tenantId,
          siteId: body.siteId,
          contractorPartyId: body.contractorPartyId,
          sourceEngagementId: body.sourceEngagementId ?? null,
          damageCategory: body.damageCategory,
          claimedAmountMinor: body.claimedAmountMinor,
          currency: body.currency,
          rationale: body.rationale,
          notes: body.notes ?? null,
          provenance: provenance as unknown as Record<string, unknown>,
          actorId: auth.userId,
        });
        return c.json({ success: true, data: row }, 201);
      } catch (err) {
        return routeCatch(c, err, {
          code: 'DAMAGE_CLAIM_FAILED',
          status: 500,
          fallback: 'Failed to file damage claim',
        });
      }
    },
  ),
);

// ─── GET /open — list open claims ────────────────────────────────────

app.get('/open', zValidator('query', OpenQuerySchema), async (c: any) => {
  const db = c.get('db');
  if (!db) return notConfigured(c);
  const auth = c.get('auth') as AuthShape;
  const { limit } = c.req.valid('query');
  try {
    const repo = new DamageClaimRepository(db);
    const rows = await repo.listOpenClaims(auth.tenantId, limit);
    return c.json({ success: true, data: rows });
  } catch (err) {
    return routeCatch(c, err, {
      code: 'DAMAGE_LIST_FAILED',
      status: 500,
      fallback: 'Failed to list open damage claims',
    });
  }
});

// ─── GET /:id — read a single claim ──────────────────────────────────

app.get('/:id', async (c: any) => {
  const db = c.get('db');
  if (!db) return notConfigured(c);
  const auth = c.get('auth') as AuthShape;
  const id = c.req.param('id');
  try {
    const repo = new DamageClaimRepository(db);
    const row = await repo.findClaimById(id, auth.tenantId);
    if (!row) return notFound(c, 'Damage claim not found');
    return c.json({ success: true, data: row });
  } catch (err) {
    return routeCatch(c, err, {
      code: 'DAMAGE_READ_FAILED',
      status: 500,
      fallback: 'Failed to read damage claim',
    });
  }
});

// ─── POST /:id/respond — owner counter / rationale ───────────────────

app.post(
  '/:id/respond',
  zValidator('json', RespondSchema),
  withSecurityEvents(
    {
      action: 'damage-claim.respond',
      resource: 'damage-claim',
      severity: 'warning',
    },
    async (c: any) => {
      const db = c.get('db');
      if (!db) return notConfigured(c);
      const auth = c.get('auth') as AuthShape;
      const id = c.req.param('id');
      const body = c.req.valid('json');
      try {
        const repo = new DamageClaimRepository(db);
        const provenance = resolveProvenance(c, body, { trustedSource: true });
        const row = await repo.respond(id, auth.tenantId, {
          counterProposalMinor: body.counterProposalMinor ?? null,
          rationale: body.rationale,
          provenance: provenance as unknown as Record<string, unknown>,
          actorId: auth.userId,
        });
        if (!row) return notFound(c, 'Damage claim not found');
        return c.json({ success: true, data: row });
      } catch (err) {
        if (err instanceof ClaimStateError) return stateConflict(c, err);
        return routeCatch(c, err, {
          code: 'DAMAGE_RESPOND_FAILED',
          status: 500,
          fallback: 'Failed to record response',
        });
      }
    },
  ),
);

// ─── POST /:id/settle — agree + finalise ─────────────────────────────

app.post(
  '/:id/settle',
  zValidator('json', SettleSchema),
  withSecurityEvents(
    {
      action: 'damage-claim.settle',
      resource: 'damage-claim',
      severity: 'warning',
    },
    async (c: any) => {
      const db = c.get('db');
      if (!db) return notConfigured(c);
      const auth = c.get('auth') as AuthShape;
      const id = c.req.param('id');
      const body = c.req.valid('json');
      try {
        const repo = new DamageClaimRepository(db);
        const provenance = resolveProvenance(c, body, { trustedSource: true });
        const row = await repo.settle(id, auth.tenantId, {
          agreedAmountMinor: body.agreedAmountMinor,
          notes: body.notes ?? null,
          provenance: provenance as unknown as Record<string, unknown>,
          actorId: auth.userId,
        });
        if (!row) return notFound(c, 'Damage claim not found');
        return c.json({ success: true, data: row });
      } catch (err) {
        if (err instanceof ClaimStateError) return stateConflict(c, err);
        return routeCatch(c, err, {
          code: 'DAMAGE_SETTLE_FAILED',
          status: 500,
          fallback: 'Failed to settle damage claim',
        });
      }
    },
  ),
);

// ─── POST /rehabilitation-plans/:planId/action-plans/:actionPlanId/approve ──

app.post(
  '/rehabilitation-plans/:planId/action-plans/:actionPlanId/approve',
  zValidator('json', ApprovePlanSchema),
  withSecurityEvents(
    {
      action: 'rehabilitation.action-plan.approve',
      resource: 'rehabilitation-action-plan',
      severity: 'warning',
    },
    async (c: any) => {
      const db = c.get('db');
      if (!db) return notConfigured(c);
      const auth = c.get('auth') as AuthShape;
      const planId = c.req.param('planId');
      const actionPlanId = c.req.param('actionPlanId');
      const body = c.req.valid('json');
      try {
        const repo = new DamageClaimRepository(db);
        if (!(await repo.planExists(planId, auth.tenantId))) {
          return notFound(c, 'Rehabilitation plan not found for this tenant');
        }
        const provenance = resolveProvenance(c, body, { trustedSource: true });
        const row = await repo.approveActionPlan(
          actionPlanId,
          planId,
          auth.tenantId,
          auth.userId,
          provenance as unknown as Record<string, unknown>,
        );
        if (!row) return notFound(c, 'Rehabilitation action plan not found');
        return c.json({ success: true, data: row });
      } catch (err) {
        if (err instanceof ClaimStateError) return stateConflict(c, err);
        return routeCatch(c, err, {
          code: 'REHAB_PLAN_APPROVE_FAILED',
          status: 500,
          fallback: 'Failed to approve rehabilitation action plan',
        });
      }
    },
  ),
);

export const damageClaimsRouter = app;
export default damageClaimsRouter;
