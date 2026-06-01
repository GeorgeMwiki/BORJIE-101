/**
 * create_licence — a CONFIRM-REQUIRED domain verb.
 *
 * Inserts a real row into the canonical `licences` table (the same table
 * backing `/api/v1/mining/licences` — see routes/mining/licences.hono.ts).
 * A chat-created licence is indistinguishable from a form-created one
 * downstream: same id strategy (randomUUID), same required columns, same
 * `status` default ('active'), same timestamps.
 *
 * This verb NEVER auto-executes. It is registered `autoSafe:false`
 * (registry.ts) so the brain-teach auto-execute path and `/micro-action`
 * both refuse it; ONLY `/confirm-action` (after the owner explicitly
 * confirmed via a confirmation_card) reaches this handler, and only after
 * the fail-closed `decideAutoAuthorization` gate authorizes it.
 *
 * MONEY BOUNDARY (CLAUDE.md hard rule): the `licences` row is a regulatory
 * title, not a ledger entry — it carries NO NOT-NULL money column. The
 * `fees` jsonb (annual_fee_tzs, royalty_rate_pct, …) is the only place a
 * money figure could live; we DELIBERATELY leave it at its DB default
 * (`{}`) so chat never writes a fee/royalty figure. A licence fee is set
 * via the dedicated compliance surface. We therefore use the domain repo
 * directly (NO LedgerService).
 *
 * REQUIRED FK the owner cannot type from chat — `company_id` (a licence is
 * held by a company; NOT NULL). We resolve it from the tenant's
 * most-recent company when omitted; if the tenant has no company on file
 * we fail precisely (`create_licence_requires_company`) rather than guess
 * — mirroring add_employee's company resolution exactly.
 *
 * The `create_licence` param shape is `{ type, number?, authority?,
 * siteId?, expiresAt? }`:
 *   - `type`      → the NOT-NULL `kind` column (PL|PML|ML|SML|…).
 *   - `number`    → the NOT-NULL `number` column. The table has a UNIQUE
 *                   (tenant_id, kind, number) index, so when the owner
 *                   omits the government number we synthesise a unique
 *                   `CHAT-<8hex>` placeholder the owner can amend later.
 *   - `authority` → NOT a column; stashed in the `obligations` jsonb
 *                   alongside chat provenance (no money written there).
 *   - `siteId`    → NOT a column (a site belongs to a licence, not vice
 *                   versa). When given we VERIFY it is the tenant's own
 *                   site (graceful FK-not-found) and record the
 *                   association in `obligations`; we never write a column
 *                   that does not exist.
 *   - `expiresAt` → the nullable `expiry_date` column (ISO YYYY-MM-DD).
 * The NOT-NULL `mineral` column has no chat param, so — exactly like
 * create_site's mineral default — we default it to 'unspecified'.
 *
 * RLS FORCE: the `/confirm-action` databaseMiddleware binds
 * `app.current_tenant_id`, so the WITH CHECK policy clips the insert to
 * the caller's tenant. We ALSO set `tenantId: ctx.tenantId` on the insert
 * and predicate the company / site lookups on the bound tenant
 * (belt-and-braces, matching the sibling handlers).
 */

import { randomUUID } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';

import { companies, licences, sites } from '@borjie/database';

import { appendExecAudit } from '../audit.js';
import type { ActionHandler, ExecContext, ExecResult } from '../types.js';

/**
 * Licence kinds per the `licences` schema. We accept the documented set
 * and normalise to upper-case (the column stores upper-case codes). An
 * unrecognised value still passes (free-form `kind`) but is upper-cased.
 */
const LICENCE_KINDS = [
  'PL',
  'PML',
  'ML',
  'SML',
  'DEALER',
  'BROKER',
  'PROCESSING',
  'SMELTING',
  'REFINING',
] as const;

const createLicenceSchema = z.object({
  /** Licence type → the NOT-NULL `kind` column (PL|PML|ML|SML|…). */
  type: z.string().trim().min(1).max(40),
  /** Government licence number. NOT-NULL column; synthesised when omitted. */
  number: z.string().trim().min(1).max(120).optional(),
  /** Issuing authority. Not a column — stored in `obligations` jsonb. */
  authority: z.string().trim().min(1).max(200).optional(),
  /** Optional associated site (verified tenant-scoped; stored in jsonb). */
  siteId: z.string().trim().min(1).max(80).optional(),
  /** ISO-8601 date (YYYY-MM-DD). Optional; `expiry_date` is nullable. */
  expiresAt: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'expiresAt must be an ISO date (YYYY-MM-DD)')
    .optional(),
  /** Optional explicit company; else resolved to the tenant's latest. */
  companyId: z.string().trim().min(1).max(80).optional(),
});

/** Normalise `type` → the upper-case code the `kind` column stores. */
function normalizeKind(type: string): string {
  const upper = type.trim().toUpperCase();
  const known = LICENCE_KINDS.find((k) => k === upper);
  return known ?? upper;
}

/**
 * Resolve the company the new licence is held by. Uses the caller-supplied
 * id when present (verified to belong to the tenant), else the tenant's
 * most-recent company. Throws a precise error when neither resolves so the
 * dispatcher surfaces a clear `reason` instead of a raw FK violation.
 */
async function resolveCompanyId(
  ctx: ExecContext,
  explicit: string | undefined,
): Promise<string> {
  if (explicit) {
    const owned = await ctx.db
      .select({ id: companies.id })
      .from(companies)
      .where(and(eq(companies.tenantId, ctx.tenantId), eq(companies.id, explicit)))
      .limit(1);
    if (!owned[0]) {
      throw new Error(`create_licence_company_not_found:${explicit}`);
    }
    return String(owned[0].id);
  }

  const latest = await ctx.db
    .select({ id: companies.id })
    .from(companies)
    .where(eq(companies.tenantId, ctx.tenantId))
    .orderBy(desc(companies.createdAt))
    .limit(1);
  if (!latest[0]) {
    throw new Error('create_licence_requires_company');
  }
  return String(latest[0].id);
}

/**
 * Verify an optional associated site belongs to the tenant. Returns the id
 * or null. Throws when an explicit site does not belong to the tenant so
 * the dispatcher surfaces a clear `reason` instead of silently dropping it.
 */
async function resolveSiteId(
  ctx: ExecContext,
  explicit: string | undefined,
): Promise<string | null> {
  if (!explicit) return null;
  const owned = await ctx.db
    .select({ id: sites.id })
    .from(sites)
    .where(and(eq(sites.tenantId, ctx.tenantId), eq(sites.id, explicit)))
    .limit(1);
  if (!owned[0]) {
    throw new Error(`create_licence_site_not_found:${explicit}`);
  }
  return String(owned[0].id);
}

export const createLicenceHandler: ActionHandler = async (
  rawInput: unknown,
  ctx: ExecContext,
): Promise<ExecResult> => {
  const input = createLicenceSchema.parse(rawInput);
  const companyId = await resolveCompanyId(ctx, input.companyId);
  const siteId = await resolveSiteId(ctx, input.siteId);

  const kind = normalizeKind(input.type);
  // The (tenant_id, kind, number) UNIQUE index requires a number. When the
  // owner omits the government number we synthesise a unique placeholder.
  const number = input.number ?? `CHAT-${randomUUID().slice(0, 8).toUpperCase()}`;

  const id = randomUUID();
  const now = new Date();
  // `obligations` is a metadata/checklist jsonb (NOT a money column — fees
  // live in `fees`, which we leave at its `{}` default). We record chat
  // provenance + the authority + any associated site here.
  const obligations: Record<string, unknown> = {
    via: 'chat',
    createdBy: ctx.userId,
    ...(input.authority ? { authority: input.authority } : {}),
    ...(siteId ? { siteId } : {}),
  };

  const inserted = await ctx.db
    .insert(licences)
    .values({
      id,
      tenantId: ctx.tenantId,
      companyId,
      kind,
      number,
      mineral: 'unspecified',
      holderUserId: null,
      grantDate: null,
      ...(input.expiresAt ? { expiryDate: input.expiresAt } : {}),
      areaHa: null,
      polygon: null,
      status: 'active',
      // `fees` (the money jsonb) is DELIBERATELY left at its DB default
      // (`{}`) — chat never writes a fee / royalty figure (money path).
      obligations,
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: licences.id, kind: licences.kind, number: licences.number });

  const row = inserted[0];
  if (!row) {
    throw new Error('licence insert returned no row');
  }

  await appendExecAudit(ctx, {
    action: 'mining.licence.create',
    turnId: String(row.id),
    details: {
      licenceId: String(row.id),
      kind: String(row.kind),
      number: String(row.number),
      companyId,
      ...(siteId ? { siteId } : {}),
      source: 'chat-confirm-action',
    },
  });

  ctx.logger.info?.(
    {
      executor: 'create_licence',
      tenantId: ctx.tenantId,
      licenceId: row.id,
      companyId,
    },
    'action-executor: licence created',
  );

  return {
    kind: 'licence',
    id: String(row.id),
    summary: `Licence ${String(row.kind)} ${String(row.number)} created`,
    data: {
      licenceId: String(row.id),
      type: String(row.kind),
      number: String(row.number),
      companyId,
      ...(siteId ? { siteId } : {}),
    },
  };
};
