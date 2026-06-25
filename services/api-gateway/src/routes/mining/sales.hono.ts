/**
 * /api/v1/mining/sales — ore-parcel sale transactions.
 *
 * Routes:
 *   GET   /     list (filter by parcelId, buyerId, paymentStatus)
 *   POST  /     create sale (auto-flip parcel to `sold`; sourced from
 *               an accepted bid when `bidId` provided)
 *
 * Migrated to `@hono/zod-openapi` (issue #60).
 */

import { OpenAPIHono } from '@hono/zod-openapi';
import { randomUUID } from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import { sales, oreParcels } from '@borjie/database';
import { withSecurityEvents } from '@borjie/observability';
import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import { recordActivationEvent } from '../../services/activation-events/record-activation-event';
import { postSaleProceeds } from '../../composition/ledger/post-sale-proceeds';
import { createLogger } from '../../utils/logger';
import { salesListRoute, salesCreateRoute } from './_openapi/route-defs';

const moduleLogger = createLogger('mining-sales');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DrizzleDb = any;

const app = new OpenAPIHono();
app.use('*', authMiddleware);
app.use('*', databaseMiddleware);

app.openapi(salesListRoute, async (c) => {
  const { tenantId } = c.get('auth');
  const db = c.get('db');
  const q = c.req.valid('query');
  const limit = Math.min(Number(q.limit ?? 100), 500);
  const conds = [eq(sales.tenantId, tenantId)];
  if (q.parcelId) conds.push(eq(sales.parcelId, q.parcelId));
  if (q.buyerId) conds.push(eq(sales.buyerId, q.buyerId));
  if (q.paymentStatus) conds.push(eq(sales.paymentStatus, q.paymentStatus));
  const rows = await db
    .select()
    .from(sales)
    .where(and(...conds))
    .orderBy(desc(sales.ts))
    .limit(limit);
  return c.json({ success: true as const, data: rows }, 200);
});

app.openapi(
  salesCreateRoute,
  withSecurityEvents(
    { action: 'mining.sale.create', resource: 'mining.sale', severity: 'info' },
    async (c) => {
      const { tenantId } = c.get('auth');
      const db = c.get('db') as DrizzleDb;
      const input = c.req.valid('json');
      const saleId = randomUUID();

      // Insert the sale, flip the parcel, and post the proceeds journal in ONE
      // tenant-bound transaction so a failed ledger post rolls back the sale
      // (no phantom, off-ledger revenue) AND a SELECT … FOR UPDATE guard makes
      // the parcel un-double-sellable under concurrency. The parcel-status
      // vocabulary is in_stockpile|in_transit|at_buyer|sold|spoiled — we refuse
      // to re-sell anything already `sold`.
      let outcome:
        | { kind: 'ok'; row: Record<string, unknown> }
        | { kind: 'not_found' }
        | { kind: 'already_sold' };
      try {
        outcome = await db.transaction(async (tx: DrizzleDb) => {
          // FOR UPDATE row-locks the parcel so a concurrent sale waits here
          // and then observes status='sold' below (no double-sell).
          const locked = await tx.execute(sql`
            SELECT id, status
              FROM ore_parcels
             WHERE id = ${input.parcelId}
               AND tenant_id = ${tenantId}
             LIMIT 1
             FOR UPDATE
          `);
          const parcelRow = (
            Array.isArray(locked)
              ? locked
              : ((locked as { rows?: ReadonlyArray<Record<string, unknown>> })
                  .rows ?? [])
          )[0] as { status?: string } | undefined;
          if (!parcelRow) return { kind: 'not_found' as const };
          if (parcelRow.status === 'sold') {
            return { kind: 'already_sold' as const };
          }

          const [row] = await tx
            .insert(sales)
            .values({
              id: saleId,
              tenantId,
              parcelId: input.parcelId,
              buyerId: input.buyerId ?? null,
              route: input.route,
              weighbridgeDocId: input.weighbridgeDocId ?? null,
              vehiclePlate: input.vehiclePlate ?? null,
              driverUserId: input.driverUserId ?? null,
              grossPriceUsd: input.grossPriceUsd ?? null,
              grossPriceTzs: input.grossPriceTzs ?? null,
              fxAtSaleTzsPerUsd: input.fxAtSaleTzsPerUsd ?? null,
              royaltyPct: input.royaltyPct ?? null,
              inspectionPct: input.inspectionPct ?? null,
              vatPct: input.vatPct ?? null,
              otherLevies: input.otherLevies ?? {},
              netTzs: input.netTzs ?? null,
              paymentStatus: input.paymentStatus,
              ts: new Date(),
            })
            .returning();

          await tx
            .update(oreParcels)
            .set({ status: 'sold' })
            .where(
              and(
                eq(oreParcels.id, input.parcelId),
                eq(oreParcels.tenantId, tenantId),
              ),
            );

          // Money path goes through LedgerService.post() ONLY (CLAUDE.md). A
          // failed post throws and rolls back the whole tx — no off-ledger
          // sale survives. Idempotent on saleId so a retried POST replays.
          await postSaleProceeds({
            db: tx,
            tenantId,
            saleId,
            grossPriceTzs: input.grossPriceTzs ?? null,
            grossPriceUsd: input.grossPriceUsd ?? null,
            royaltyPct: input.royaltyPct ?? null,
            vatPct: input.vatPct ?? null,
            inspectionPct: input.inspectionPct ?? null,
            otherLevies: input.otherLevies ?? {},
          });

          return { kind: 'ok' as const, row };
        });
      } catch (err) {
        moduleLogger.error(
          { err, tenantId, parcelId: input.parcelId },
          'sale_create_failed',
        );
        // No money moved — the whole transaction rolled back (no phantom sale).
        return c.json(
          {
            success: false as const,
            error: {
              code: 'SALE_POST_FAILED',
              message: 'Could not record the sale. No money moved.',
            },
          },
          500,
        );
      }

      if (outcome.kind === 'not_found') {
        return c.json(
          {
            success: false as const,
            error: { code: 'NOT_FOUND', message: 'Parcel not found' },
          },
          404,
        );
      }
      if (outcome.kind === 'already_sold') {
        // Business conflict (the parcel was already sold). Surfaced as a 400
        // business error — the salesCreateRoute envelope reserves 400 for
        // "validation or business error" (no 409 declared on this route).
        return c.json(
          {
            success: false as const,
            error: {
              code: 'PARCEL_ALREADY_SOLD',
              message: 'This parcel has already been sold.',
            },
          },
          400,
        );
      }

      // Activation funnel (fail-soft — never breaks the sale write; stays
      // OUTSIDE the transaction so a telemetry failure never rolls back money).
      void recordActivationEvent({
        db,
        tenantId,
        eventType: 'first_sale_recorded',
        props: {
          saleId,
          parcelId: input.parcelId,
          route: input.route,
        },
      });

      // The runtime row IS the SaleSchema shape (Drizzle `.returning()` row);
      // the tx wrapper widens its static type, so we assert the response shape.
      return c.json(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { success: true as const, data: outcome.row as any },
        201,
      );
    },
  ),
);

export const miningSalesRouter = app;
