/**
 * /api/v1/internal/modules — the operator-gated self-BUILDING control plane.
 *
 * Wave W3c. A recorded capability gap (the gap register / md_commitments,
 * migration 0326) drives spec → generate → dry-run → PROPOSAL. The MD can now
 * ACT on a gap it DETECTED — but only as far as a stored proposal an operator
 * reviews. NOTHING here applies code to the running system.
 *
 * Routes (ALL behind Supabase JWT + SUPER_ADMIN):
 *   POST /propose            Drive ONE gap → a stored PROPOSAL via a dry-run.
 *                            Body: { gapId, scopedToolIds? }.
 *   GET  /                   List the tenant's proposals (newest first).
 *   GET  /:id                Fetch one proposal (module + dry-run DDL).
 *   POST /:id/approve        Record an operator APPROVAL (PROPOSED → APPROVED).
 *                            APPROVAL ONLY — does NOT apply the migration.
 *
 * HARD RULES (enforced here):
 *   - SUPER_ADMIN only (Borjie-internal operators; never a tenant self-serve).
 *   - No autonomous code application: /propose stores status='proposed';
 *     /:id/approve flips lifecycle to APPROVED but applies NOTHING. APPLY is a
 *     SEPARATE, explicitly four-eye-gated step (the four-eye approvals router +
 *     the module-spawning executor) — intentionally NOT mounted here.
 *   - Everything is audit-chained (ai_audit_chain, per-tenant hash chain).
 *   - Honest-degrade: a missing engine dep / DB yields a structured 503, never
 *     a crash. zod-validated bodies. Pino logger only (no console).
 *
 * Tenant scope: `databaseMiddleware` binds the tenant GUC; the self-build
 * stores additionally carry an explicit tenant predicate (defence in depth).
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { createHash, randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';

import { createDrizzleMdCommitmentRepository } from '@borjie/database';

/**
 * Minimal structural view of a repo commitment. Re-declared locally because the
 * `@borjie/database` barrel surfaces `MdCommitment` as a namespace the workspace
 * resolver cannot use as a TYPE (same workaround documented in
 * services/api-gateway/src/services/owner-identity/resolver.ts). Covers only the
 * fields `toRecordedGap` reads.
 */
interface MdCommitment {
  readonly id: string;
  readonly tenantId: string;
  readonly gapKind?: string | null;
  readonly kind: string;
  readonly title: string;
  readonly titleSw?: string | null;
  readonly rationale?: string | null;
  readonly competenceDomain?: string | null;
  readonly unblockTrigger?: {
    readonly kind: string;
    readonly target: string;
  } | null;
}
import { authMiddleware, requireRole } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import { UserRole } from '../../types/user-role';
import { createLogger } from '../../utils/logger';
import {
  createSelfBuildWiring,
  type SelfBuildOrchestrator,
  type RecordedGap,
} from '../../composition/self-build/index.js';

const moduleLogger = createLogger('internal-modules');

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const proposeSchema = z.object({
  /** The recorded gap (md_commitments.id, gap_kind non-null) to drive. */
  gapId: z.string().min(1).max(128),
  /** Optional tool ids the proposed module's juniors may reach. */
  scopedToolIds: z.array(z.string().min(1).max(128)).max(64).optional(),
});

// ---------------------------------------------------------------------------
// Envelope helpers
// ---------------------------------------------------------------------------

function ok<T>(data: T) {
  return { success: true as const, data };
}
function err(code: string, message: string) {
  return { success: false as const, error: { code, message } };
}

// ---------------------------------------------------------------------------
// Composition seam (test-injectable). Tests set
// `c.set('services', { selfBuildOrchestrator, selfBuildGapSource })` to avoid a
// DB; production lazily builds both from `c.get('db')`.
// ---------------------------------------------------------------------------

/** Reads a recorded gap by id within a tenant. */
export interface SelfBuildGapSource {
  getGap(tenantId: string, gapId: string): Promise<RecordedGap | null>;
}

interface SelfBuildServices {
  readonly selfBuildOrchestrator?: SelfBuildOrchestrator;
  readonly selfBuildGapSource?: SelfBuildGapSource;
}

/** Project an md_commitments gap row onto the deriver's `RecordedGap` view. */
function toRecordedGap(c: MdCommitment): RecordedGap | null {
  if (!c.gapKind) return null; // ordinary commitment, not a capability gap
  return {
    id: c.id,
    tenantId: c.tenantId,
    gapKind: c.gapKind,
    kind: c.kind,
    title: c.title,
    // RecordedGap requires non-null titleSw/rationale — coalesce a missing
    // localized title to the EN title and a missing rationale to the title.
    titleSw: c.titleSw ?? c.title,
    rationale: c.rationale ?? c.title,
    competenceDomain: c.competenceDomain ?? null,
    unblockTrigger: c.unblockTrigger
      ? { kind: c.unblockTrigger.kind, target: c.unblockTrigger.target }
      : null,
  };
}

/** Build (or read injected) the orchestrator + gap source for this request. */
function resolveServices(c: any):
  | { ok: true; orchestrator: SelfBuildOrchestrator; gaps: SelfBuildGapSource }
  | { ok: false } {
  const injected = (c.get('services') as SelfBuildServices | undefined) ?? {};
  if (injected.selfBuildOrchestrator && injected.selfBuildGapSource) {
    return {
      ok: true,
      orchestrator: injected.selfBuildOrchestrator,
      gaps: injected.selfBuildGapSource,
    };
  }
  const db = c.get('db');
  if (!db) return { ok: false };
  const orchestrator =
    injected.selfBuildOrchestrator ?? createSelfBuildWiring({ db });
  const gapSource: SelfBuildGapSource =
    injected.selfBuildGapSource ??
    (() => {
      const repo = createDrizzleMdCommitmentRepository(db);
      return {
        async getGap(tenantId, gapId) {
          const row = await repo.get(tenantId, gapId);
          return row ? toRecordedGap(row) : null;
        },
      };
    })();
  return { ok: true, orchestrator, gaps: gapSource };
}

// ---------------------------------------------------------------------------
// Audit chain (per-tenant hash chain over ai_audit_chain) — best-effort.
// ---------------------------------------------------------------------------

async function appendAudit(
  db: any,
  payload: {
    readonly action: string;
    readonly tenantId: string;
    readonly turnId: string;
    readonly userId: string;
    readonly details: Readonly<Record<string, unknown>>;
  },
): Promise<string | null> {
  if (!db) return null;
  const id = randomUUID();
  const canonical = JSON.stringify({
    tenantId: payload.tenantId,
    turnId: payload.turnId,
    action: payload.action,
    userId: payload.userId,
    details: payload.details,
  });
  try {
    const latest: unknown = await db.execute(
      sql`SELECT COALESCE(MAX(sequence_id), 0) AS max_seq,
                 (SELECT this_hash FROM ai_audit_chain
                  WHERE tenant_id = ${payload.tenantId}
                  ORDER BY sequence_id DESC LIMIT 1) AS last_hash
            FROM ai_audit_chain
           WHERE tenant_id = ${payload.tenantId}`,
    );
    const rows =
      (latest as { rows?: ReadonlyArray<Record<string, unknown>> }).rows ??
      (latest as ReadonlyArray<Record<string, unknown>>);
    const head = (rows[0] ?? {}) as Record<string, unknown>;
    const maxSeq = Number(head.max_seq ?? 0);
    const lastHashRaw = head.last_hash;
    const lastHash =
      typeof lastHashRaw === 'string' && lastHashRaw.length > 0 ? lastHashRaw : '';
    const thisHash = createHash('sha256').update(lastHash + canonical).digest('hex');
    await db.execute(sql`
      INSERT INTO ai_audit_chain (
        id, tenant_id, sequence_id, turn_id, action,
        prev_hash, this_hash, payload, created_at
      ) VALUES (
        ${id}, ${payload.tenantId}, ${maxSeq + 1}, ${payload.turnId}, ${payload.action},
        ${lastHash}, ${thisHash},
        ${JSON.stringify({ userId: payload.userId, details: payload.details })}::jsonb,
        ${new Date().toISOString()}
      )`);
    return id;
  } catch (auditErr) {
    moduleLogger.warn('internal-modules audit append failed', {
      tenantId: payload.tenantId,
      action: payload.action,
      reason: auditErr instanceof Error ? auditErr.message : String(auditErr),
    });
    return null;
  }
}

// ---------------------------------------------------------------------------
// Router — Supabase JWT + SUPER_ADMIN gate on EVERY route.
// ---------------------------------------------------------------------------

const app = new Hono();
app.use('*', authMiddleware);
app.use('*', databaseMiddleware);
app.use('*', requireRole(UserRole.SUPER_ADMIN));

// POST /propose — drive ONE recorded gap → a stored PROPOSAL via a dry-run.
app.post('/propose', async (c: any) => {
  const auth = c.get('auth') as { tenantId: string; userId: string };
  const raw = await c.req.json().catch(() => null);
  const parsed = proposeSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json(err('VALIDATION_ERROR', 'Invalid propose body'), 400);
  }
  const services = resolveServices(c);
  if (!services.ok) {
    return c.json(
      err('SELF_BUILD_UNAVAILABLE', 'Self-build engine is not configured'),
      503,
    );
  }
  const gap = await services.gaps.getGap(auth.tenantId, parsed.data.gapId);
  if (!gap) {
    return c.json(
      err('GAP_NOT_FOUND', 'No recorded capability gap with that id'),
      404,
    );
  }
  const result = await services.orchestrator.driveGapToProposal({
    gap,
    driverUserId: auth.userId,
    scopedToolIds: parsed.data.scopedToolIds,
  });
  if (!result.ok) {
    moduleLogger.warn('internal-modules: propose degraded', {
      tenantId: auth.tenantId,
      gapId: parsed.data.gapId,
      reason: result.reason,
    });
    return c.json(
      { ...err('PROPOSE_FAILED', `Could not derive a proposal: ${result.reason}`), details: result.errors },
      422,
    );
  }
  const auditId = await appendAudit(c.get('db'), {
    action: 'self_build.module.proposed',
    tenantId: auth.tenantId,
    turnId: result.moduleId,
    userId: auth.userId,
    details: {
      gapId: parsed.data.gapId,
      moduleId: result.moduleId,
      specId: result.specId,
      moduleSlug: result.moduleSlug,
      specStatus: result.specStatus,
      dryRun: result.dryRun,
    },
  });
  moduleLogger.info('internal-modules: gap driven to proposal', {
    tenantId: auth.tenantId,
    gapId: parsed.data.gapId,
    moduleId: result.moduleId,
  });
  return c.json(
    ok({
      moduleId: result.moduleId,
      specId: result.specId,
      moduleSlug: result.moduleSlug,
      specStatus: result.specStatus,
      dryRun: result.dryRun,
      // The proposal is NEVER applied here — apply is a separate four-eye step.
      applied: false,
      auditId,
    }),
    201,
  );
});

// GET / — list proposals for the tenant.
app.get('/', async (c: any) => {
  const auth = c.get('auth') as { tenantId: string };
  const services = resolveServices(c);
  if (!services.ok) {
    return c.json(
      err('SELF_BUILD_UNAVAILABLE', 'Self-build engine is not configured'),
      503,
    );
  }
  const proposals = await services.orchestrator.listProposals(auth.tenantId);
  return c.json(ok({ proposals }), 200);
});

// GET /:id — fetch one proposal (module + dry-run DDL).
app.get('/:id', async (c: any) => {
  const auth = c.get('auth') as { tenantId: string };
  const moduleId = c.req.param('id');
  const services = resolveServices(c);
  if (!services.ok) {
    return c.json(
      err('SELF_BUILD_UNAVAILABLE', 'Self-build engine is not configured'),
      503,
    );
  }
  const proposal = await services.orchestrator.getProposal(auth.tenantId, moduleId);
  if (!proposal) {
    return c.json(err('NOT_FOUND', 'Proposal not found'), 404);
  }
  return c.json(ok({ proposal }), 200);
});

// POST /:id/approve — record an operator APPROVAL (PROPOSED → APPROVED).
// APPROVAL ONLY: this NEVER applies the migration. The apply path is a
// separate four-eye-gated step and is intentionally not reachable here.
app.post('/:id/approve', async (c: any) => {
  const auth = c.get('auth') as { tenantId: string; userId: string };
  const moduleId = c.req.param('id');
  const services = resolveServices(c);
  if (!services.ok) {
    return c.json(
      err('SELF_BUILD_UNAVAILABLE', 'Self-build engine is not configured'),
      503,
    );
  }
  const recorded = await services.orchestrator.recordApproval(auth.tenantId, moduleId);
  if (!recorded) {
    return c.json(
      err('NOT_PROPOSED', 'No PROPOSED proposal with that id to approve'),
      409,
    );
  }
  const auditId = await appendAudit(c.get('db'), {
    action: 'self_build.module.approved',
    tenantId: auth.tenantId,
    turnId: moduleId,
    userId: auth.userId,
    details: { moduleId, note: 'approval recorded; apply remains a separate four-eye step' },
  });
  moduleLogger.info('internal-modules: proposal approval recorded', {
    tenantId: auth.tenantId,
    moduleId,
    approverId: auth.userId,
  });
  return c.json(
    ok({
      moduleId,
      lifecycleState: 'APPROVED',
      // Approval is NOT apply. The migration is applied only via the separate
      // four-eye-gated executor path — never as a side effect of this route.
      applied: false,
      auditId,
    }),
    200,
  );
});

export const internalModulesRouter = app;
export default internalModulesRouter;
