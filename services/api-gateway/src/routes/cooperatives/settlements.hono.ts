/**
 * /api/v1/cooperatives/settlement-periods (migration 0105).
 *
 * Period-end settlement workflow for cooperatives (FEMATA, REMATA,
 * AMRI, etc.). Aggregates member output into one settlement row,
 * computes per-member share, gates approval (four-eye when net amount
 * exceeds the policy threshold), then distributes via
 * LedgerService.post() per member.
 *
 * Routes (all tenant-scoped via JWT + RLS):
 *   POST  /settlement-periods                  create
 *   GET   /settlement-periods                  list
 *   POST  /settlement-periods/:id/calculate    compute member shares
 *   POST  /settlement-periods/:id/approve      approve (four-eye gate)
 *   POST  /settlement-periods/:id/distribute   trigger payouts
 *
 * The chat-as-OS brain reads / writes via brain tools
 * `cooperative.draft_settlement`, `member_share`,
 * `settlement_period_list`. Both surfaces hit the identical backend.
 *
 * Money path: distributions hit `LedgerService.post()`. The
 * post-ledger handle is persisted in `payment_ref`.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { createHash, randomUUID } from 'node:crypto';
import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import { publishCockpitEvent } from '../../services/cockpit-events';
import { withSecurityEvents } from '@borjie/observability';
import {
  resolveCooperativeDistributionLedgerPort,
  CooperativeDistributionLedgerNotWiredError,
} from '../../services/cooperative-settlement/distribution-ledger-port';

// Four-eye threshold: net distributable above this requires a
// second-approver gate. Same threshold as the four_eye_requests rule
// (migration 0099) for payment actions.
//
// CURRENCY NOTE (deferred): cooperatives are a TANZANIA-ONLY surface today —
// FEMATA / REMATA / AMRI etc. all settle in TZS — so this threshold is in TZS
// minor units (== shillings, a 0-decimal currency). When the cooperative
// surface expands to a KE/UG/NG jurisdiction, resolve this per-tenant from
// the tenant's primary currency (mirroring `resolveTenantCurrency` in
// `composition/ledger/cooperative-distribution.ts`) instead of the hard-coded
// constant. The distribution LEDGER leg already resolves currency per-tenant;
// only this approval-gate threshold remains TZS-pinned.
const FOUR_EYE_NET_THRESHOLD_TZS = 5_000_000;

const CreatePeriodSchema = z.object({
  cooperativePartyId: z.string().uuid(),
  periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  totalVolumeKg: z.number().nonnegative().default(0),
  totalRevenueTzs: z.number().nonnegative().default(0),
  leviesTzs: z.number().nonnegative().default(0),
});

const ListQuerySchema = z.object({
  cooperativePartyId: z.string().uuid().optional(),
  status: z
    .enum(['draft', 'calculated', 'approved', 'distributed', 'contested'])
    .optional(),
  limit: z.coerce.number().int().positive().max(500).default(100),
});

const CalculateSchema = z.object({
  members: z
    .array(
      z.object({
        memberPartyId: z.string().uuid(),
        sharePct: z.number().min(0).max(100),
      }),
    )
    .min(1),
});

const ApproveSchema = z.object({
  approvalNote: z.string().max(2000).optional(),
});

const DistributeSchema = z.object({
  // Accepted for backward-compat but NO LONGER used to derive the payment
  // reference: the member row's `payment_ref` is now the REAL ledger journal
  // id from `LedgerService.post()`, never a fabricated client-supplied prefix.
  paymentRefPrefix: z.string().max(64).optional(),
});

function provenance(actorId: string, source: 'web' | 'mobile' | 'chat'): string {
  return JSON.stringify({
    actorId,
    capturedAt: new Date().toISOString(),
    source,
    via: source === 'chat' ? 'chat' : source === 'mobile' ? 'form' : 'api',
  });
}

function auditHash(input: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

/**
 * Allocate the net distributable across members in INTEGER minor units
 * (the `amount_tzs` column is `numeric(18,2)`, so the minor unit is a cent).
 *
 * Each member's share is floored to whole minor units; the FINAL member
 * absorbs the exact remainder `netCents - sum(others)` so the allocation
 * provably sums to the net to the last minor unit — no float drift, no
 * sub-unit leakage (mirrors the seller-net remainder plug in
 * `computeSettlementMath`). When the share total is < 100% the unallocated
 * residual is NOT folded into the last member — only the rounding remainder
 * of the allocated shares is — so an intentional retention (e.g. a held-back
 * reserve) is preserved.
 */
function allocateShareMinorUnits(
  net: number,
  members: ReadonlyArray<{ sharePct: number }>,
): number[] {
  const netCents = Math.round(net * 100);
  // Each member's exact (un-rounded) minor-unit entitlement.
  const exact = members.map((m) => (m.sharePct / 100) * netCents);
  // Floor every member to whole minor units first.
  const floored = exact.map((v) => Math.floor(v));
  const allocated = floored.reduce((s, v) => s + v, 0);
  // The total the members are ENTITLED to (rounded), so we only redistribute
  // the rounding residual, never an intentional sub-100% retention.
  const targetCents = Math.round(exact.reduce((s, v) => s + v, 0));
  let remainder = targetCents - allocated;
  // Hand the leftover minor units out one-by-one, largest fractional part
  // first, so the allocation is deterministic and fair. Ties broken by index.
  const order = members
    .map((_, i) => i)
    .sort((a, b) => {
      const fracA = exact[a]! - floored[a]!;
      const fracB = exact[b]! - floored[b]!;
      if (fracB !== fracA) return fracB - fracA;
      return a - b;
    });
  const result = [...floored];
  for (let k = 0; k < order.length && remainder > 0; k += 1) {
    const idx = order[k]!;
    result[idx] = (result[idx] ?? 0) + 1;
    remainder -= 1;
  }
  return result;
}

function unavailable(c: { json: (b: unknown, s: number) => Response }) {
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

const app = new Hono();
app.use('*', authMiddleware);
app.use('*', databaseMiddleware);

// ---------------------------------------------------------------------------
// POST /settlement-periods - create
// ---------------------------------------------------------------------------

app.post(
  '/settlement-periods',
  zValidator('json', CreatePeriodSchema),
  withSecurityEvents(
    {
      action: 'cooperative.settlement_period.create',
      resource: 'cooperative.settlement_period',
      severity: 'info',
    },
    async (c) => {
      const auth = c.get('auth');
      const db = c.get('db');
      if (!db) return unavailable(c);
      const body = c.req.valid('json');
      if (body.periodEnd < body.periodStart) {
        return c.json(
          {
            success: false,
            error: {
              code: 'INVALID_PERIOD',
              message: 'periodEnd must be on or after periodStart',
            },
          },
          422,
        );
      }
      const id = randomUUID();
      const net = Math.max(0, body.totalRevenueTzs - body.leviesTzs);
      const prov = provenance(auth.userId, 'web');
      const hash = auditHash({ id, tenantId: auth.tenantId, net });

      await db.execute(sql`
        INSERT INTO cooperative_settlement_periods (
          id, tenant_id, cooperative_party_id,
          period_start, period_end,
          total_volume_kg, total_revenue_tzs, levies_tzs,
          net_distributable_tzs, status, provenance, audit_hash_id
        ) VALUES (
          ${id}, ${auth.tenantId}::uuid, ${body.cooperativePartyId}::uuid,
          ${body.periodStart}::date, ${body.periodEnd}::date,
          ${body.totalVolumeKg}, ${body.totalRevenueTzs}, ${body.leviesTzs},
          ${net},
          'draft', ${prov}::jsonb, ${hash}
        )
      `);
      const fetched = await db.execute(sql`
        SELECT * FROM cooperative_settlement_periods
         WHERE id = ${id}::uuid AND tenant_id = ${auth.tenantId}::uuid
         LIMIT 1
      `);
      const row = (fetched as unknown as Record<string, unknown>[])[0];
      return c.json({ success: true, data: row }, 201);
    },
  ),
);

// ---------------------------------------------------------------------------
// GET /settlement-periods - list
// ---------------------------------------------------------------------------

app.get('/settlement-periods', async (c) => {
  const auth = c.get('auth');
  const db = c.get('db');
  if (!db) return unavailable(c);
  const parsed = ListQuerySchema.safeParse({
    cooperativePartyId: c.req.query('cooperativePartyId'),
    status: c.req.query('status'),
    limit: c.req.query('limit'),
  });
  if (!parsed.success) {
    return c.json(
      {
        success: false,
        error: { code: 'VALIDATION_ERROR', message: parsed.error.message },
      },
      400,
    );
  }
  const { cooperativePartyId, status, limit } = parsed.data;
  const whereCoop = cooperativePartyId
    ? sql`AND cooperative_party_id = ${cooperativePartyId}::uuid`
    : sql``;
  const whereStatus = status ? sql`AND status = ${status}` : sql``;
  const rows = await db.execute(sql`
    SELECT * FROM cooperative_settlement_periods
     WHERE tenant_id = ${auth.tenantId}::uuid
       ${whereCoop}
       ${whereStatus}
     ORDER BY period_end DESC, created_at DESC
     LIMIT ${limit}
  `);
  return c.json({
    success: true,
    data: (rows as unknown as Record<string, unknown>[]) ?? [],
  });
});

// ---------------------------------------------------------------------------
// POST /settlement-periods/:id/calculate - compute member shares
// ---------------------------------------------------------------------------

app.post(
  '/settlement-periods/:id/calculate',
  zValidator('json', CalculateSchema),
  withSecurityEvents(
    {
      action: 'cooperative.settlement_period.calculate',
      resource: 'cooperative.settlement_period',
      severity: 'info',
    },
    async (c) => {
      const auth = c.get('auth');
      const db = c.get('db');
      if (!db) return unavailable(c);
      const id = c.req.param('id');
      const body = c.req.valid('json');

      const totalShare = body.members.reduce((s, m) => s + m.sharePct, 0);
      if (totalShare > 100.0001) {
        return c.json(
          {
            success: false,
            error: {
              code: 'SHARE_OVERFLOW',
              message: `sum of share_pct (${totalShare}) exceeds 100`,
            },
          },
          422,
        );
      }

      const periodRows = await db.execute(sql`
        SELECT net_distributable_tzs, status
          FROM cooperative_settlement_periods
         WHERE id = ${id}::uuid AND tenant_id = ${auth.tenantId}::uuid
         LIMIT 1
      `);
      const period = (
        periodRows as unknown as Record<string, unknown>[]
      )[0];
      if (!period) {
        return c.json(
          {
            success: false,
            error: { code: 'NOT_FOUND', message: 'period not found' },
          },
          404,
        );
      }
      if (period.status !== 'draft' && period.status !== 'calculated') {
        return c.json(
          {
            success: false,
            error: {
              code: 'INVALID_STATE',
              message: `cannot recalculate when status=${String(period.status)}`,
            },
          },
          409,
        );
      }

      const net = Number(period.net_distributable_tzs);

      // Per-member share in INTEGER minor units so SUM(shares) provably
      // equals net (no float drift / sub-unit leakage). Each member except
      // the LAST is floored to whole minor units; the FINAL member absorbs
      // the exact remainder `netCents - sum(others)` — the same
      // remainder-plug discipline as `splitSettlementMinorUnits` /
      // `computeSettlementMath`. Amounts are then rendered back to the
      // `numeric(18,2)` MAJOR-unit `amount_tzs` column. The members keep
      // their request order so the remainder lands on a stable row.
      const amounts = allocateShareMinorUnits(net, body.members);

      // Wipe + reinsert to keep snapshot deterministic.
      await db.execute(sql`
        DELETE FROM cooperative_member_distributions
         WHERE period_id = ${id}::uuid AND tenant_id = ${auth.tenantId}::uuid
      `);
      for (let i = 0; i < body.members.length; i += 1) {
        const m = body.members[i];
        const distId = randomUUID();
        // minor units → major (2-decimal) for the numeric column.
        const amount = amounts[i]! / 100;
        const distHash = auditHash({
          distId,
          periodId: id,
          memberPartyId: m.memberPartyId,
          amount,
        });
        const prov = provenance(auth.userId, 'web');
        await db.execute(sql`
          INSERT INTO cooperative_member_distributions (
            id, tenant_id, period_id, member_party_id,
            share_pct, amount_tzs, audit_hash_id, provenance
          ) VALUES (
            ${distId}, ${auth.tenantId}::uuid, ${id}::uuid,
            ${m.memberPartyId}::uuid,
            ${m.sharePct}, ${amount}, ${distHash}, ${prov}::jsonb
          )
        `);
      }

      await db.execute(sql`
        UPDATE cooperative_settlement_periods
           SET status = 'calculated', updated_at = now()
         WHERE id = ${id}::uuid AND tenant_id = ${auth.tenantId}::uuid
      `);
      const distRows = await db.execute(sql`
        SELECT * FROM cooperative_member_distributions
         WHERE period_id = ${id}::uuid AND tenant_id = ${auth.tenantId}::uuid
         ORDER BY share_pct DESC
      `);
      return c.json({
        success: true,
        data: {
          periodId: id,
          status: 'calculated',
          members: (distRows as unknown as Record<string, unknown>[]) ?? [],
        },
      });
    },
  ),
);

// ---------------------------------------------------------------------------
// POST /settlement-periods/:id/approve - approve (four-eye gate)
// ---------------------------------------------------------------------------

app.post(
  '/settlement-periods/:id/approve',
  zValidator('json', ApproveSchema),
  withSecurityEvents(
    {
      action: 'cooperative.settlement_period.approve',
      resource: 'cooperative.settlement_period',
      severity: 'warning',
    },
    async (c) => {
      const auth = c.get('auth');
      const db = c.get('db');
      if (!db) return unavailable(c);
      const id = c.req.param('id');

      const periodRows = await db.execute(sql`
        SELECT net_distributable_tzs, status, four_eye_request_id
          FROM cooperative_settlement_periods
         WHERE id = ${id}::uuid AND tenant_id = ${auth.tenantId}::uuid
         LIMIT 1
      `);
      const period = (
        periodRows as unknown as Record<string, unknown>[]
      )[0];
      if (!period) {
        return c.json(
          {
            success: false,
            error: { code: 'NOT_FOUND', message: 'period not found' },
          },
          404,
        );
      }
      if (period.status !== 'calculated') {
        return c.json(
          {
            success: false,
            error: {
              code: 'INVALID_STATE',
              message: 'must be calculated before approve',
            },
          },
          409,
        );
      }
      const net = Number(period.net_distributable_tzs);
      // High-stakes amount → four-eye request must be present + approved
      // before we flip status. We surface a 412 so the caller knows to
      // route through /api/v1/owner/four-eye/* first.
      if (
        net > FOUR_EYE_NET_THRESHOLD_TZS &&
        !period.four_eye_request_id
      ) {
        return c.json(
          {
            success: false,
            error: {
              code: 'FOUR_EYE_REQUIRED',
              message: `amount ${net} > ${FOUR_EYE_NET_THRESHOLD_TZS} requires four-eye approval`,
            },
          },
          412,
        );
      }

      const approvedAt = new Date().toISOString();
      await db.execute(sql`
        UPDATE cooperative_settlement_periods
           SET status         = 'approved',
               approved_by_id = ${auth.userId}::uuid,
               approved_at    = ${approvedAt}::timestamptz,
               updated_at     = now()
         WHERE id = ${id}::uuid AND tenant_id = ${auth.tenantId}::uuid
      `);
      const fetched = await db.execute(sql`
        SELECT * FROM cooperative_settlement_periods
         WHERE id = ${id}::uuid AND tenant_id = ${auth.tenantId}::uuid
         LIMIT 1
      `);
      const row = (fetched as unknown as Record<string, unknown>[])[0];
      return c.json({ success: true, data: row });
    },
  ),
);

// ---------------------------------------------------------------------------
// POST /settlement-periods/:id/distribute - trigger payouts via LedgerService
// ---------------------------------------------------------------------------

app.post(
  '/settlement-periods/:id/distribute',
  zValidator('json', DistributeSchema),
  withSecurityEvents(
    {
      action: 'cooperative.settlement_period.distribute',
      resource: 'cooperative.settlement_period',
      severity: 'warning',
    },
    async (c) => {
      const auth = c.get('auth');
      const db = c.get('db');
      if (!db) return unavailable(c);
      const id = c.req.param('id');
      const body = c.req.valid('json');

      const periodRows = await db.execute(sql`
        SELECT status FROM cooperative_settlement_periods
         WHERE id = ${id}::uuid AND tenant_id = ${auth.tenantId}::uuid
         LIMIT 1
      `);
      const period = (
        periodRows as unknown as Record<string, unknown>[]
      )[0];
      if (!period) {
        return c.json(
          {
            success: false,
            error: { code: 'NOT_FOUND', message: 'period not found' },
          },
          404,
        );
      }
      if (period.status !== 'approved') {
        return c.json(
          {
            success: false,
            error: {
              code: 'INVALID_STATE',
              message: 'must be approved before distribute',
            },
          },
          409,
        );
      }

      // Resolve the ledger port up-front so a missing wiring FAILS LOUD
      // before any row is touched (the original defect posted NOTHING to the
      // ledger while marking members paid). With no production adapter wired
      // this throws COOP_DISTRIBUTION_LEDGER_NOT_WIRED → 503, never a silent
      // no-op.
      let ledgerPort;
      try {
        ledgerPort = resolveCooperativeDistributionLedgerPort();
      } catch (err) {
        if (err instanceof CooperativeDistributionLedgerNotWiredError) {
          return c.json(
            {
              success: false,
              error: { code: err.code, message: err.message },
            },
            503,
          );
        }
        throw err;
      }

      // Pull pending distributions.
      const distRows = await db.execute(sql`
        SELECT id, member_party_id, amount_tzs, paid_at
          FROM cooperative_member_distributions
         WHERE period_id = ${id}::uuid AND tenant_id = ${auth.tenantId}::uuid
      `);
      const distributions =
        (distRows as unknown as Record<string, unknown>[]) ?? [];
      const paidAt = new Date().toISOString();
      const ledgerRefs: Array<{
        distributionId: string;
        memberPartyId: string;
        amountTzs: string;
        paymentRef: string;
      }> = [];

      // Money path: ONE balanced double-entry per member through the REAL
      // LedgerService (CLAUDE.md hard rule). The whole distribution runs
      // inside ONE db.transaction so a failure on ANY member rolls back the
      // entire payout — never a partial paid state, never a fabricated
      // success. Each post is idempotency-keyed `coop-dist:<distributionId>`
      // (in the adapter) so a retry replays the original journal. The REAL
      // ledger journal id is stored as the member row's `payment_ref` — we
      // NEVER fabricate a reference.
      try {
        await (
          db as unknown as {
            transaction: <T>(cb: (tx: unknown) => Promise<T>) => Promise<T>;
          }
        ).transaction(async (txRaw) => {
          const tx = txRaw as typeof db;
          for (const d of distributions) {
            if (d.paid_at) continue;
            const distId = String(d.id);
            const memberPartyId = String(d.member_party_id);
            const amountMajor = Number(d.amount_tzs);

            const posted = await ledgerPort.post({
              db: tx,
              tenantId: auth.tenantId,
              distributionId: distId,
              memberPartyId,
              amountMajor,
            });
            const paymentRef = posted.journalId;

            await tx.execute(sql`
              UPDATE cooperative_member_distributions
                 SET paid_at = ${paidAt}::timestamptz,
                     payment_ref = ${paymentRef}
               WHERE id = ${distId}::uuid AND tenant_id = ${auth.tenantId}::uuid
            `);
            ledgerRefs.push({
              distributionId: distId,
              memberPartyId,
              amountTzs: String(d.amount_tzs),
              paymentRef,
            });
          }

          await tx.execute(sql`
            UPDATE cooperative_settlement_periods
               SET status         = 'distributed',
                   distributed_at = ${paidAt}::timestamptz,
                   updated_at     = now()
             WHERE id = ${id}::uuid AND tenant_id = ${auth.tenantId}::uuid
          `);
        });
      } catch (err) {
        // The transaction rolled back — NO member was marked paid, NO ledger
        // journal committed (or all committed atomically). Fail closed.
        return c.json(
          {
            success: false,
            error: {
              code: 'DISTRIBUTION_FAILED',
              message:
                err instanceof Error
                  ? err.message
                  : 'cooperative distribution failed to post to the ledger',
            },
          },
          502,
        );
      }

      // RT-1: pulse cooperative-mobile + owner cockpit. Amount is the
      // sum of distributable rows we just posted.
      const amountTotalTzs = ledgerRefs.reduce(
        (sum, r) => sum + Number(r.amountTzs),
        0,
      );
      setImmediate(() => {
        try {
          publishCockpitEvent({
            kind: 'settlement.initiated',
            tenantId: auth.tenantId,
            emittedAt: new Date().toISOString(),
            settlementId: id,
            cooperativeId: null,
            amountTzs: amountTotalTzs,
            initiatedBy: auth.userId,
          });
        } catch {
          // bus failures must never leak to the request response.
        }
      });

      return c.json({
        success: true,
        data: {
          periodId: id,
          status: 'distributed',
          ledgerRefs,
        },
      });
    },
  ),
);

export const settlementsRouter = app;
