/**
 * log_production — a CONFIRM-REQUIRED domain verb.
 *
 * Inserts a real row into the canonical `production_records` table (the
 * granular kg/grade output substrate per DATA_MODEL.md §3.3 — the same
 * table the production-sales schema documents as "granular production
 * output"). A chat-logged production record is indistinguishable from a
 * form-logged one downstream: same id strategy (randomUUID), same required
 * columns, same `ts` default (now()).
 *
 * Why `production_records` and NOT `production_tonnage_events`: the latter
 * is an ore/waste TONNAGE event with a NOT-NULL `ore_tonnes` column and a
 * fixed strip-ratio model (it is fed by its own
 * routes/production/tonnage.hono.ts surface). The chat shape here —
 * `{ siteId, mineral, quantity, unit }` — is a general mineral-output
 * record, which maps cleanly onto `production_records` (mass + a flexible
 * `grade` jsonb) and, crucially, `production_records` carries NO money
 * column at all, so the money-path hard rule is satisfied by construction.
 *
 * This verb NEVER auto-executes. It is registered `autoSafe:false`
 * (registry.ts) so the brain-teach auto-execute path and `/micro-action`
 * both refuse it; ONLY `/confirm-action` (after the owner explicitly
 * confirmed via a confirmation_card) reaches this handler, and only after
 * the fail-closed `decideAutoAuthorization` gate authorizes it.
 *
 * MONEY BOUNDARY (CLAUDE.md hard rule): `production_records` has NO money
 * column (mass_kg / grade / recovery_pct only) — there is nothing to flag
 * and nothing is left unset for money reasons. We use the domain repo
 * directly (NO LedgerService).
 *
 * REQUIRED FK — `site_id` (NOT NULL). Unlike create_site / add_employee
 * the site is a REQUIRED param here (you log production AT a site), so we
 * do not fall back to "most recent"; we VERIFY the supplied site belongs
 * to the tenant and fail precisely (`log_production_site_not_found`) when
 * it does not (graceful FK-not-found, surfaced by the dispatcher).
 *
 * The `log_production` param shape is `{ siteId, mineral, quantity, unit,
 * date? }`:
 *   - `siteId`   → the NOT-NULL `site_id` FK (verified tenant-scoped).
 *   - `mineral`  → recorded in the `grade` jsonb (`{mineral, quantity,
 *                  unit}`); the canonical mineral/grade bag.
 *   - `quantity` → the numeric `mass_kg` column (the canonical output
 *                  magnitude) AND echoed raw into `grade` with its unit so
 *                  no precision/unit context is lost.
 *   - `unit`     → recorded in the `grade` jsonb alongside the quantity.
 *   - `date`     → the `ts` column (defaults to now() when omitted).
 * The NOT-NULL `kind` column (rom|concentrate|dore|…) has no direct chat
 * param, so — exactly like create_site's mineral default — we default it
 * to 'run_of_mine' (a documented enum value) so the row is always valid.
 *
 * RLS FORCE: the `/confirm-action` databaseMiddleware binds
 * `app.current_tenant_id`, so the WITH CHECK policy clips the insert to
 * the caller's tenant. We ALSO set `tenantId: ctx.tenantId` on the insert
 * and predicate the site lookup on the bound tenant (belt-and-braces,
 * matching the sibling handlers).
 */

import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { productionRecords, sites } from '@borjie/database';

import { appendExecAudit } from '../audit.js';
import type { ActionHandler, ExecContext, ExecResult } from '../types.js';

const logProductionSchema = z.object({
  /** Required: the site this production was logged AT (NOT-NULL FK). */
  siteId: z.string().trim().min(1).max(80),
  /** Mineral logged (recorded in the `grade` jsonb). */
  mineral: z.string().trim().min(1).max(120),
  /** Output magnitude → `mass_kg` (+ echoed into `grade` with its unit). */
  quantity: z.number().finite().nonnegative(),
  /** Unit of `quantity` (kg, t, g, oz, …) — recorded in the `grade` jsonb. */
  unit: z.string().trim().min(1).max(40),
  /** ISO-8601 date/timestamp. Optional; `ts` defaults to now() when omitted. */
  date: z
    .string()
    .trim()
    .refine((s) => Number.isFinite(new Date(s).getTime()), 'date must be a valid ISO date/timestamp')
    .optional(),
});

/**
 * Verify the REQUIRED site belongs to the tenant. Throws a precise error
 * when it does not so the dispatcher surfaces a clear `reason` instead of
 * a raw FK violation.
 */
async function resolveSiteId(ctx: ExecContext, siteId: string): Promise<string> {
  const owned = await ctx.db
    .select({ id: sites.id })
    .from(sites)
    .where(and(eq(sites.tenantId, ctx.tenantId), eq(sites.id, siteId)))
    .limit(1);
  if (!owned[0]) {
    throw new Error(`log_production_site_not_found:${siteId}`);
  }
  return String(owned[0].id);
}

export const logProductionHandler: ActionHandler = async (
  rawInput: unknown,
  ctx: ExecContext,
): Promise<ExecResult> => {
  const input = logProductionSchema.parse(rawInput);
  const siteId = await resolveSiteId(ctx, input.siteId);

  const id = randomUUID();
  // `grade` is the flexible mineral/grade jsonb bag — we record the mineral,
  // the raw quantity, and its unit (plus chat provenance) so nothing is
  // lost when `quantity` is also projected onto the numeric `mass_kg`.
  const grade: Record<string, unknown> = {
    via: 'chat',
    createdBy: ctx.userId,
    mineral: input.mineral,
    quantity: input.quantity,
    unit: input.unit,
  };

  const inserted = await ctx.db
    .insert(productionRecords)
    .values({
      id,
      tenantId: ctx.tenantId,
      siteId,
      // `kind` is NOT NULL with no DB default — default to a documented
      // enum value so the row is always valid (owner can refine later).
      kind: 'run_of_mine',
      // `mass_kg` is the canonical numeric output magnitude. Drizzle's
      // `numeric` maps to a string at the ORM boundary.
      massKg: String(input.quantity),
      grade,
      // NO money column on this table — nothing to flag, nothing unset.
      ...(input.date ? { ts: new Date(input.date) } : {}),
    })
    .returning({ id: productionRecords.id, siteId: productionRecords.siteId });

  const row = inserted[0];
  if (!row) {
    throw new Error('production record insert returned no row');
  }

  await appendExecAudit(ctx, {
    action: 'mining.production.log',
    turnId: String(row.id),
    details: {
      productionRecordId: String(row.id),
      siteId,
      mineral: input.mineral,
      quantity: input.quantity,
      unit: input.unit,
      source: 'chat-confirm-action',
    },
  });

  ctx.logger.info?.(
    {
      executor: 'log_production',
      tenantId: ctx.tenantId,
      productionRecordId: row.id,
      siteId,
    },
    'action-executor: production logged',
  );

  return {
    kind: 'production_record',
    id: String(row.id),
    summary: `Logged ${input.quantity} ${input.unit} of ${input.mineral}`,
    data: {
      productionRecordId: String(row.id),
      siteId,
      mineral: input.mineral,
      quantity: input.quantity,
      unit: input.unit,
    },
  };
};
