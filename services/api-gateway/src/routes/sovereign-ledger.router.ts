// @ts-nocheck — Hono v4 status-literal-union widens c.json() return; matches
// the convention used by audit-trail.router.ts and admin-jarvis.router.ts.

/**
 * Sovereign action-ledger admin HTTP surface — Wave-K Tier-3 W-Ops.
 *
 * `appendLedgerEntry` / `getLedgerTail` / `verifyLedgerChain` from
 * `@borjie/database` already power the agency-side hash-chained
 * ledger (migration 0129), but until this router they had no admin HTTP
 * surface. Operators could neither inspect the chain tail nor force a
 * verify-on-demand from outside the in-process cron — a regression for
 * the audit-grade contract LITFIN parity Gap C closed at the data
 * layer.
 *
 * Two endpoints:
 *
 *   GET  /api/v1/admin/sovereign-ledger/tail?tenantId=X&n=50
 *     Returns the last `n` ledger rows (capped at 1000 by the service)
 *     for the named tenant. SUPER_ADMIN + ADMIN only — append-only
 *     audit data is platform-tier sensitive even within a tenancy.
 *
 *   POST /api/v1/admin/sovereign-ledger/verify
 *     Body: `{ tenantId }`. Walks the full chain via the service-side
 *     forward-walk verifier and returns either `{ ok: true, count }`
 *     or `{ ok: false, brokenAt, expected, actual, reason }`.
 *     Emits `sovereign-ledger.verify-triggered` on the shared event
 *     bus the moment the verify is dispatched so a tamper-attempt
 *     "let me check, oh look it's broken" sequence is itself
 *     observable.
 *
 * Auth: both routes share the SUPER_ADMIN/ADMIN gate. The router
 * carries no tenant-context fallback for the verify path — operators
 * must name the tenant explicitly; routing platform-tier admins to
 * "verify some tenant" by accident would be a footgun.
 *
 * Degraded mode: when `DATABASE_URL` is unset the service registry's
 * `db` slot is null. The router returns `503 SOVEREIGN_LEDGER_UNAVAILABLE`
 * so clients can distinguish "not configured" from "configured + broken".
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { createSovereignActionLedgerService } from '@borjie/database';
import { authMiddleware, requireRole } from '../middleware/hono-auth';
import { UserRole } from '../types/user-role';
import { routeCatch } from '../utils/safe-error';

const TailQuerySchema = z
  .object({
    tenantId: z.string().min(1).max(128),
    n: z
      .string()
      .optional()
      .transform((v) => {
        if (!v) return 50;
        const parsed = Number.parseInt(v, 10);
        if (!Number.isFinite(parsed) || parsed <= 0) return 50;
        return Math.min(1000, parsed);
      }),
  })
  .strict();

const VerifyBodySchema = z
  .object({
    tenantId: z.string().min(1).max(128),
  })
  .strict();

const app = new Hono();
app.use('*', authMiddleware);
// Platform-tier only — SUPER_ADMIN + ADMIN. Tenant admins do not touch
// the sovereign-action ledger; their tenancy-scoped audit surface lives
// at /audit-trail.
app.use('*', requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN));

function notConfigured(c: any) {
  return c.json(
    {
      success: false,
      error: {
        code: 'SOVEREIGN_LEDGER_UNAVAILABLE',
        message:
          'Sovereign action-ledger requires a live database connection',
      },
    },
    503,
  );
}

function getDbOrNull(c: any): unknown | null {
  const services = c.get('services') ?? {};
  return services.db ?? null;
}

function getEventBusOrNull(c: any): unknown | null {
  const services = c.get('services') ?? {};
  return services.eventBus ?? null;
}

// ---------------------------------------------------------------------------
// GET /tail — return the most recent N ledger rows for a tenant.
// ---------------------------------------------------------------------------
app.get('/tail', zValidator('query', TailQuerySchema), async (c: any) => {
  const db = getDbOrNull(c);
  if (!db) return notConfigured(c);

  const { tenantId, n } = c.req.valid('query');
  try {
    const service = createSovereignActionLedgerService(db as never);
    const rows = await service.getLedgerTail(tenantId, n);
    return c.json({
      success: true,
      data: {
        tenantId,
        count: rows.length,
        rows,
      },
    });
  } catch (err) {
    // HIGH-9 (audit .audit/post-pr90-api-mcp-bug-sweep.md): do NOT echo
    // raw db err.message — it leaks column names, constraint identifiers
    // and SQL-state codes even to SUPER_ADMIN callers. Route through
    // routeCatch which sanitises into a generic message + correlation id.
    return routeCatch(c, err, {
      code: 'SOVEREIGN_LEDGER_TAIL_FAILED',
      status: 500,
      fallback: 'sovereign-ledger tail read failed',
    });
  }
});

// ---------------------------------------------------------------------------
// POST /verify — walk the chain for a tenant and report integrity.
// ---------------------------------------------------------------------------
app.post('/verify', zValidator('json', VerifyBodySchema), async (c: any) => {
  const db = getDbOrNull(c);
  if (!db) return notConfigured(c);

  const { tenantId } = c.req.valid('json');
  const auth = c.get('auth');
  const bus = getEventBusOrNull(c) as
    | { publish?: (env: unknown) => Promise<void> | void }
    | null;

  // Emit BEFORE we run the verify so a tamper-actor cannot make the
  // verify silent by killing the process between walk and emit.
  if (bus && typeof bus.publish === 'function') {
    try {
      await bus.publish({
        event: {
          eventId: `sov_ledger_verify_${Date.now()}`,
          eventType: 'sovereign-ledger.verify-triggered',
          timestamp: new Date().toISOString(),
          tenantId,
          correlationId: `sov_verify_${Date.now()}`,
          causationId: null,
          metadata: {
            triggeredBy: auth?.userId ?? 'unknown',
            triggeredByRole: auth?.role ?? 'unknown',
          },
          payload: { tenantId },
        } as any,
        version: 1,
        aggregateId: tenantId,
        aggregateType: 'SovereignActionLedger',
      });
    } catch {
      // Best-effort emit. Verify still runs — operators can correlate
      // via the response anyway.
    }
  }

  try {
    const service = createSovereignActionLedgerService(db as never);
    const result = await service.verifyLedgerChain(tenantId);
    // Surface success/failure as HTTP 200 either way — the verdict is
    // the payload. A 5xx would conflate "verify ran + chain broken"
    // with "verify itself failed", which the regulator-export
    // consumers conflate at their peril.
    return c.json({ success: true, data: result });
  } catch (err) {
    // HIGH-9: sanitise the response — never expose raw db error details.
    return routeCatch(c, err, {
      code: 'SOVEREIGN_LEDGER_VERIFY_FAILED',
      status: 500,
      fallback: 'sovereign-ledger verify failed',
    });
  }
});

export default app;
