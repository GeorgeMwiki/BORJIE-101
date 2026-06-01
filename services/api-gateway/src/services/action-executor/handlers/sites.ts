/**
 * create_site — a CONFIRM-REQUIRED domain verb.
 *
 * Inserts a real row into the canonical `sites` table (the same table
 * backing `/api/v1/mining/sites` — see routes/mining/sites.hono.ts). A
 * chat-created site is indistinguishable from a form-created one
 * downstream: same id strategy (randomUUID), same required columns, same
 * `status` default ('active'), same timestamps.
 *
 * This verb NEVER auto-executes. It is registered `autoSafe:false`
 * (registry.ts) so the brain-teach auto-execute path and `/micro-action`
 * both refuse it; ONLY `/confirm-action` (after the owner explicitly
 * confirmed via a confirmation_card) reaches this handler, and only after
 * the fail-closed `decideAutoAuthorization` gate authorizes it.
 *
 * NOT money: `sites` carries no money column, so we use the domain repo
 * directly (no LedgerService). It DOES carry one NOT-NULL foreign key the
 * owner cannot type from chat — `licence_id` (a site belongs to a
 * licence). We resolve it from the tenant's most-recent licence when the
 * caller omits it; if the tenant has no licence on file we fail precisely
 * (`create_site_requires_licence`) rather than guessing.
 *
 * RLS FORCE: the `/confirm-action` databaseMiddleware binds
 * `app.current_tenant_id`, so the WITH CHECK policy clips the insert to
 * the caller's tenant. We ALSO set `tenantId: ctx.tenantId` on the insert
 * and predicate the licence lookup on the bound tenant (belt-and-braces,
 * matching the reminders handler).
 */

import { randomUUID } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';

import { licences, sites } from '@borjie/database';

import { appendExecAudit } from '../audit.js';
import type { ActionHandler, ExecContext, ExecResult } from '../types.js';

/**
 * Site phases per the `sites` schema. Defaulted to `pre_licence` at the DB
 * level; we accept the early-stage phases an owner would set up from chat
 * and let anything else fall back to the column default.
 */
const SITE_PHASES = [
  'pre_licence',
  'exploration',
  'access_prep',
  'sampling',
  'trenching',
  'shafting',
  'extraction',
] as const;

const SITE_STATUSES = ['active', 'paused', 'abandoned', 'under_rehab'] as const;

const createSiteSchema = z.object({
  name: z.string().trim().min(1).max(200),
  /** Optional — caller may name a district/region; stored in attributes. */
  district: z.string().trim().min(1).max(200).optional(),
  region: z.string().trim().min(1).max(200).optional(),
  /** Primary mineral (NOT NULL in schema; defaults to 'unspecified'). */
  mineral: z.string().trim().min(1).max(120).optional(),
  status: z.enum(SITE_STATUSES).optional(),
  phase: z.enum(SITE_PHASES).optional(),
  /**
   * Optional explicit licence. When omitted we resolve the tenant's
   * most-recent licence (a site MUST belong to one — NOT NULL FK).
   */
  licenceId: z.string().trim().min(1).max(80).optional(),
});

/**
 * Resolve the licence the new site belongs to. Uses the caller-supplied
 * id when present (verified to belong to the tenant), else the tenant's
 * most-recent licence. Throws a precise error when neither resolves so the
 * dispatcher surfaces a clear `reason` instead of a raw FK violation.
 */
async function resolveLicenceId(
  ctx: ExecContext,
  explicit: string | undefined,
): Promise<string> {
  if (explicit) {
    const owned = await ctx.db
      .select({ id: licences.id })
      .from(licences)
      .where(and(eq(licences.tenantId, ctx.tenantId), eq(licences.id, explicit)))
      .limit(1);
    if (!owned[0]) {
      throw new Error(`create_site_licence_not_found:${explicit}`);
    }
    return String(owned[0].id);
  }

  const latest = await ctx.db
    .select({ id: licences.id })
    .from(licences)
    .where(eq(licences.tenantId, ctx.tenantId))
    .orderBy(desc(licences.createdAt))
    .limit(1);
  if (!latest[0]) {
    throw new Error('create_site_requires_licence');
  }
  return String(latest[0].id);
}

export const createSiteHandler: ActionHandler = async (
  rawInput: unknown,
  ctx: ExecContext,
): Promise<ExecResult> => {
  const input = createSiteSchema.parse(rawInput);
  const licenceId = await resolveLicenceId(ctx, input.licenceId);

  const id = randomUUID();
  const now = new Date();
  const attributes: Record<string, unknown> = {
    // Chat-as-OS provenance + the free-form locality the owner named.
    via: 'chat',
    createdBy: ctx.userId,
    ...(input.district ? { district: input.district } : {}),
    ...(input.region ? { region: input.region } : {}),
  };

  const inserted = await ctx.db
    .insert(sites)
    .values({
      id,
      tenantId: ctx.tenantId,
      licenceId,
      name: input.name,
      mineral: input.mineral ?? 'unspecified',
      location: null,
      polygon: null,
      ...(input.phase ? { phase: input.phase } : {}),
      managerUserId: null,
      status: input.status ?? 'active',
      attributes,
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: sites.id, name: sites.name, status: sites.status });

  const row = inserted[0];
  if (!row) {
    throw new Error('site insert returned no row');
  }

  await appendExecAudit(ctx, {
    action: 'mining.site.create',
    turnId: String(row.id),
    details: {
      siteId: String(row.id),
      name: input.name,
      licenceId,
      status: String(row.status),
      source: 'chat-confirm-action',
    },
  });

  ctx.logger.info?.(
    {
      executor: 'create_site',
      tenantId: ctx.tenantId,
      siteId: row.id,
      licenceId,
    },
    'action-executor: site created',
  );

  return {
    kind: 'site',
    id: String(row.id),
    summary: `Site "${input.name}" created`,
    data: {
      siteId: String(row.id),
      name: input.name,
      licenceId,
      status: String(row.status),
    },
  };
};
