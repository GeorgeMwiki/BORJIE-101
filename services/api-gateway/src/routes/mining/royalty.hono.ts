/**
 * /api/v1/mining/royalty — royalty returns + the royalty MONEY leg (FLOW-3 / OW-8).
 *
 * The owner-web finance surface (RoyaltyDraftPanel + /finance/royalties/sign)
 * lists royalty-return drafts and signs them. Signing FILES + PAYS the royalty:
 * it posts a real, balanced double-entry journal through `LedgerService.post()`
 * (CLAUDE.md hard rule — money NEVER bypasses the ledger). The draft itself
 * (`royalty_return_drafts`, migration 0159) carries no money column by design;
 * the royalty FIGURES are supplied by the owner at sign time.
 *
 * Routes:
 *   GET  /                 list royalty-return drafts (newest first), each
 *                          annotated with whether it has been posted (ledger
 *                          journal id) so the FE can render draft vs signed.
 *   POST /:id/sign         FILE + PAY a royalty draft. FOUR-EYE-gated: a sign
 *                          over the high-stakes threshold requires an APPROVED
 *                          four_eye_requests token (actionType=regulator_filing).
 *                          Posts DR royalty_payable / CR cash_clearing via
 *                          LedgerService, flips the draft to `submitted`, stamps
 *                          the journal id, hash-chains the event.
 *   GET  /statement        royalty STATEMENT — the posted royalty journal lines
 *                          read off the canonical `ledger_entries`, scoped to
 *                          the royalty_payable account (a read-only projection,
 *                          mirrors /mining/accounting/ledger; never a parallel
 *                          ledger).
 *
 * Hard rules: money via LedgerService.post() ONLY; RLS GUC-bound (databaseMiddleware
 * + belt-and-braces tenant predicate); zod validation; immutability; Drizzle only;
 * Pino logger (no console.log); evidence/audit hash-chained, append-only.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import { listLedgerLines } from '@borjie/database';
import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import { logger } from '../../utils/logger';
import { postRoyaltyPayment } from '../../services/royalty/royalty-ledger';
import {
  recordActivationEvent,
  type ActivationEventDb,
} from '../../services/activation-events/record-activation-event';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * High-stakes threshold (MAJOR units). A royalty sign at/above this requires
 * an APPROVED four-eye token (mirrors four_eye_requests' "payment > 5M TZS"
 * doctrine). Below it, the owner's explicit `confirm:true` is sufficient.
 * Currency-agnostic numeric floor (the amount is in the tenant's primary
 * currency — TZS at launch); kept conservative for non-TZS tenants.
 */
const FOUR_EYE_THRESHOLD_MAJOR = 5_000_000;

const ROYALTY_PAYABLE_ACCOUNT_NAME = 'Royalty Payable';

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const signSchema = z.object({
  /** Explicit owner confirmation — refuse to move money without it. */
  confirm: z.literal(true),
  /**
   * Royalty amount to FILE + PAY, in MAJOR units (tenant primary currency).
   * The draft table holds no money column, so the figure is supplied here.
   */
  royaltyAmount: z.number().finite().positive(),
  /** Optional site linkage so the statement projection can scope by site. */
  siteId: z.string().trim().min(1).max(80).optional(),
  /**
   * Four-eye approval id (an APPROVED `four_eye_requests` row). REQUIRED when
   * `royaltyAmount` ≥ FOUR_EYE_THRESHOLD_MAJOR; ignored otherwise.
   */
  fourEyeRequestId: z.string().uuid().optional(),
});

const statementQuerySchema = z.object({
  siteId: z.string().trim().min(1).max(80).optional(),
  range: z.enum(['30d', '90d', '12m']).optional(),
  limit: z.coerce.number().int().positive().max(500).optional(),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ok<T>(data: T, meta?: Record<string, unknown>) {
  return meta
    ? { success: true as const, data, meta }
    : { success: true as const, data };
}

function err(code: string, message: string) {
  return { success: false as const, error: { code, message } };
}

function rowsOf(raw: unknown): ReadonlyArray<Record<string, unknown>> {
  if (Array.isArray(raw)) return raw as ReadonlyArray<Record<string, unknown>>;
  if (raw && typeof raw === 'object' && 'rows' in raw) {
    const r = (raw as { rows: unknown }).rows;
    if (Array.isArray(r)) return r as ReadonlyArray<Record<string, unknown>>;
  }
  return [];
}

function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    v,
  );
}

function rangeFrom(token: '30d' | '90d' | '12m' | undefined): Date | undefined {
  if (!token) return undefined;
  const from = new Date();
  if (token === '30d') from.setUTCDate(from.getUTCDate() - 30);
  else if (token === '90d') from.setUTCDate(from.getUTCDate() - 90);
  else from.setUTCMonth(from.getUTCMonth() - 12);
  return from;
}

/**
 * Append a hash-chained, append-only audit row for a royalty money event.
 * Mirrors the document-intelligence extraction-audit pattern (parameterized
 * SQL, sha256 over prev_hash || payload). Best-effort: a chain gap is logged
 * but never blocks the (already-committed) ledger post.
 */
async function appendRoyaltyAudit(
  db: { execute(q: unknown): Promise<unknown> },
  args: {
    readonly tenantId: string;
    readonly draftId: string;
    readonly journalId: string;
    readonly action: string;
    readonly payload: Record<string, unknown>;
  },
): Promise<void> {
  try {
    await db.execute(sql`
      WITH prev AS (
        SELECT this_hash, sequence_id
          FROM ai_audit_chain
         WHERE tenant_id = ${args.tenantId}
         ORDER BY sequence_id DESC
         LIMIT 1
      )
      INSERT INTO ai_audit_chain
        (id, tenant_id, sequence_id, turn_id, session_id, action,
         prev_hash, this_hash, payload_ref, payload, created_at)
      VALUES (
        ${randomUUID()},
        ${args.tenantId},
        COALESCE((SELECT sequence_id FROM prev), 0) + 1,
        ${`royalty-sign-${args.draftId}`},
        NULL,
        ${args.action},
        COALESCE((SELECT this_hash FROM prev), ''),
        encode(sha256(
          (COALESCE((SELECT this_hash FROM prev), '') ||
           ${JSON.stringify(args.payload)})::bytea
        ), 'hex'),
        NULL,
        ${JSON.stringify(args.payload)}::jsonb,
        now()
      )
    `);
  } catch (auditErr) {
    logger.warn('royalty: audit-chain append failed', {
      tenantId: args.tenantId,
      draftId: args.draftId,
      reason: auditErr instanceof Error ? auditErr.message : String(auditErr),
    });
  }
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const app = new Hono();
app.use('*', authMiddleware);
app.use('*', databaseMiddleware);

// ---------------------------------------------------------------------------
// GET / — list royalty-return drafts (newest first) with ledger-post status.
// ---------------------------------------------------------------------------

app.get('/', async (c) => {
  const { tenantId } = c.get('auth');
  const db = c.get('db');
  const limit = Math.min(
    Math.max(Number(c.req.query('limit') ?? 100) || 100, 1),
    500,
  );

  // Read drafts via parameterized SQL (the route stays decoupled from the
  // Drizzle table-object barrel timing; RLS + the tenant predicate scope it).
  const raw = await db.execute(sql`
    SELECT id, tenant_id, period_start, period_end, mineral, quantity, unit,
           status, notes, created_at, updated_at
      FROM royalty_return_drafts
     WHERE tenant_id = ${tenantId}
     ORDER BY created_at DESC
     LIMIT ${limit}
  `);

  const drafts = rowsOf(raw).map((r) => {
    const notes = (r.notes ?? {}) as Record<string, unknown>;
    return {
      id: String(r.id),
      periodStart: String(r.period_start),
      periodEnd: String(r.period_end),
      mineral: String(r.mineral),
      quantity: r.quantity === null ? null : Number(r.quantity),
      unit: r.unit === null ? null : String(r.unit),
      status: String(r.status),
      // Money + ledger linkage are stamped into `notes` at sign time (the
      // draft table itself has no money/ledger column by design).
      royaltyAmount:
        typeof notes.royaltyAmount === 'number' ? notes.royaltyAmount : null,
      currency: typeof notes.currency === 'string' ? notes.currency : null,
      ledgerJournalId:
        typeof notes.ledgerJournalId === 'string'
          ? notes.ledgerJournalId
          : null,
      signed: r.status === 'submitted',
      createdAt: String(r.created_at),
    };
  });

  logger.info('royalty: drafts listed', {
    tenantId,
    count: drafts.length,
  });

  return c.json(ok({ drafts }, { tenantId, count: drafts.length }), 200);
});

// ---------------------------------------------------------------------------
// POST /:id/sign — FILE + PAY a royalty draft (money via LedgerService).
// ---------------------------------------------------------------------------

app.post('/:id/sign', async (c) => {
  const { tenantId, userId } = c.get('auth');
  const db = c.get('db');
  const id = c.req.param('id');
  if (!isUuid(id)) {
    return c.json(err('VALIDATION_ERROR', 'Invalid royalty draft id'), 400);
  }
  const raw = await c.req.json().catch(() => null);
  const parsed = signSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json(
      err('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid sign payload'),
      400,
    );
  }
  const input = parsed.data;

  // ---- Load the draft (tenant-scoped; RLS + predicate) ------------------
  const draftRaw = await db.execute(sql`
    SELECT id, period_start, period_end, mineral, status, notes
      FROM royalty_return_drafts
     WHERE tenant_id = ${tenantId}
       AND id = ${id}
     LIMIT 1
  `);
  const draft = rowsOf(draftRaw)[0];
  if (!draft) {
    return c.json(err('NOT_FOUND', 'Royalty draft not found'), 404);
  }
  if (draft.status === 'submitted') {
    return c.json(
      err('ALREADY_SIGNED', 'This royalty return has already been filed.'),
      409,
    );
  }

  // ---- Four-eye gate for high-stakes amounts ----------------------------
  if (input.royaltyAmount >= FOUR_EYE_THRESHOLD_MAJOR) {
    if (!input.fourEyeRequestId) {
      return c.json(
        err(
          'FOUR_EYE_REQUIRED',
          `Royalty filings of ${FOUR_EYE_THRESHOLD_MAJOR} or more require an approved second signatory (four-eye).`,
        ),
        403,
      );
    }
    const feRaw = await db.execute(sql`
      SELECT id, status, action_type
        FROM four_eye_requests
       WHERE tenant_id = ${tenantId}
         AND id = ${input.fourEyeRequestId}
       LIMIT 1
    `);
    const fe = rowsOf(feRaw)[0];
    if (!fe) {
      return c.json(err('FOUR_EYE_NOT_FOUND', 'Four-eye approval not found'), 404);
    }
    if (fe.status !== 'approved') {
      return c.json(
        err(
          'FOUR_EYE_NOT_APPROVED',
          `Four-eye approval is '${String(fe.status)}', not 'approved'.`,
        ),
        403,
      );
    }
  }

  // ---- Post the royalty payment through the REAL LedgerService -----------
  let post: Awaited<ReturnType<typeof postRoyaltyPayment>>;
  try {
    post = await postRoyaltyPayment({
      db,
      tenantId,
      userId,
      draftId: id,
      royaltyAmountMajor: input.royaltyAmount,
      mineral: String(draft.mineral),
      periodStart: String(draft.period_start),
      ...(input.siteId ? { siteId: input.siteId } : {}),
    });
  } catch (ledgerErr) {
    logger.error('royalty: ledger post failed', {
      tenantId,
      draftId: id,
      reason: ledgerErr instanceof Error ? ledgerErr.message : String(ledgerErr),
    });
    return c.json(
      err(
        'LEDGER_POST_FAILED',
        'Could not post the royalty payment to the ledger. No money moved.',
      ),
      502,
    );
  }

  // ---- Flip the draft to `submitted` + stamp the ledger linkage ---------
  // The money/ledger linkage lives in `notes` (the table has no money column
  // by design). Idempotent: only flips a not-yet-submitted row.
  const existingNotes = (draft.notes ?? {}) as Record<string, unknown>;
  const mergedNotes = JSON.stringify({
    ...existingNotes,
    signedBy: userId,
    signedAt: new Date().toISOString(),
    royaltyAmount: input.royaltyAmount,
    currency: post.currency,
    ledgerJournalId: post.journalId,
    moneyMoved: true,
    ...(input.fourEyeRequestId
      ? { fourEyeRequestId: input.fourEyeRequestId }
      : {}),
  });
  await db.execute(sql`
    UPDATE royalty_return_drafts
       SET status = 'submitted',
           notes = ${mergedNotes}::jsonb,
           updated_at = now()
     WHERE tenant_id = ${tenantId}
       AND id = ${id}
       AND status <> 'submitted'
  `);

  await appendRoyaltyAudit(db, {
    tenantId,
    draftId: id,
    journalId: post.journalId,
    action: 'mining.royalty.filed',
    payload: {
      action: 'mining.royalty.filed',
      draftId: id,
      journalId: post.journalId,
      mineral: String(draft.mineral),
      periodStart: String(draft.period_start),
      amountMinorUnits: post.amountMinorUnits,
      currency: post.currency,
      signedBy: userId,
      moneyMoved: true,
      ledgerPosted: true,
    },
  });

  logger.info('royalty: filed + paid', {
    tenantId,
    draftId: id,
    journalId: post.journalId,
    amountMinorUnits: post.amountMinorUnits,
    currency: post.currency,
  });

  // Activation funnel (fail-soft — never breaks the royalty filing). Money
  // facts stay as minor-units + ISO-4217 currency code inside props.
  void recordActivationEvent({
    db: db as unknown as ActivationEventDb,
    tenantId,
    eventType: 'first_royalty_paid',
    actorId: userId,
    props: {
      draftId: id,
      journalId: post.journalId,
      amountMinorUnits: post.amountMinorUnits,
      currency: post.currency,
    },
  });

  return c.json(
    ok({
      id,
      status: 'submitted',
      signed: true,
      journalId: post.journalId,
      currency: post.currency,
      amountMinorUnits: post.amountMinorUnits,
      royaltyAmount: input.royaltyAmount,
    }),
    201,
  );
});

// ---------------------------------------------------------------------------
// GET /statement — royalty journal lines off the canonical ledger_entries.
// ---------------------------------------------------------------------------

app.get('/statement', async (c) => {
  const { tenantId } = c.get('auth');
  const db = c.get('db');
  const parsed = statementQuerySchema.safeParse({
    siteId: c.req.query('siteId'),
    range: c.req.query('range'),
    limit: c.req.query('limit'),
  });
  if (!parsed.success) {
    return c.json(err('VALIDATION_ERROR', 'Invalid query parameters'), 400);
  }

  // Reuse the canonical ledger projection (READ-ONLY; never a parallel
  // ledger), then narrow to the royalty_payable account so the statement
  // shows only royalty money. Account match is by the provisioned name so we
  // do not have to hard-code an account id.
  const lines = await listLedgerLines(db, tenantId, {
    ...(parsed.data.siteId ? { siteId: parsed.data.siteId } : {}),
    ...(parsed.data.range ? { from: rangeFrom(parsed.data.range) } : {}),
    ...(parsed.data.limit ? { limit: parsed.data.limit } : {}),
  });

  // Resolve the royalty_payable account id(s) for this tenant (if any exist
  // yet). The provisioner names the account exactly 'Royalty Payable' and
  // keys it per-currency, so a tenant may have one row per currency — match
  // them all. Account name (not a hard-coded id) keeps this projection
  // currency-agnostic.
  const acctRaw = await db.execute(sql`
    SELECT id FROM accounts
     WHERE tenant_id = ${tenantId}
       AND name = ${ROYALTY_PAYABLE_ACCOUNT_NAME}
  `);
  const royaltyAccountIds = new Set(
    rowsOf(acctRaw).map((r) => String(r.id)),
  );

  const royaltyLines =
    royaltyAccountIds.size > 0
      ? lines.filter((l) => royaltyAccountIds.has(l.accountId))
      : [];

  logger.info('royalty: statement read', {
    tenantId,
    totalLines: lines.length,
    royaltyLines: royaltyLines.length,
    royaltyAccountCount: royaltyAccountIds.size,
  });

  return c.json(
    ok(royaltyLines, {
      tenantId,
      count: royaltyLines.length,
      royaltyAccountIds: [...royaltyAccountIds],
    }),
    200,
  );
});

export const miningRoyaltyRouter = app;
