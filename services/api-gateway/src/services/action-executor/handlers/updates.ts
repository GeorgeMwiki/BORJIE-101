/**
 * UPDATE verbs — CONFIRM-REQUIRED domain edits.
 *
 *   update_site        — edit a `sites` row        (name / mineral / phase / status / locality).
 *   update_employee    — edit an `employees` row   (name / role / siteId / startDate / status).
 *   update_licence     — edit a `licences` row     (number / status / expiresAt / authority).
 *   update_production  — edit a `production_records` row (mineral / quantity / unit).
 *   update_reminder    — edit a `reminders` row    (title / body / channel).
 *
 * These complete the "Mr. Mwikila can EDIT anything" half of universal MD power.
 * The create_* / add_* / log_* verbs already insert; these patch. A chat-edited
 * row is indistinguishable from a form-edited one downstream.
 *
 * Each verb NEVER auto-executes. All are registered `autoSafe:false`
 * (registry.ts) so the brain-teach auto-execute path and `/micro-action` both
 * refuse them; ONLY `/confirm-action` (after the owner explicitly confirmed via a
 * confirmation_card) reaches these handlers, and only after the fail-closed
 * `decideAutoAuthorization` gate authorizes it.
 *
 * MONEY BOUNDARY (CLAUDE.md hard rule). These verbs touch NO money column:
 *   - sites carry no money column.
 *   - employees carry one (`wage_rate_tzs`) that is NEVER patched here — a wage
 *     edit is a money figure and stays out of scope (the owner sets it on the
 *     dedicated workforce surface). Our schema simply has no `wage` field.
 *   - licences carry only a `fees` jsonb that we NEVER write (left untouched).
 *   - production_records carry NO money column at all (mass/grade only).
 *   - reminders are non-money calendar items.
 * None import LedgerService; none write a ledger/journal row.
 *
 * TENANT SCOPING: the `/confirm-action` databaseMiddleware binds
 * `app.current_tenant_id`, so RLS clips every UPDATE to the caller's tenant. We
 * ALSO predicate every `UPDATE … WHERE tenant_id = ctx.tenantId AND id = …`
 * (belt-and-braces per CLAUDE.md) — a cross-tenant id therefore matches zero rows
 * and the handler fails precisely (`*_not_found`) instead of silently touching
 * another tenant's row. Reminders additionally constrain by `owner_id`.
 *
 * Every successful edit appends a hash-chained `ai_audit_chain` entry via
 * `appendExecAudit` (action `*.update`). An edit that matches no row throws so
 * the dispatcher returns a graceful `{ executed:false, reason }`.
 */

import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import {
  employees,
  licences,
  productionRecords,
  reminders,
  REMINDER_CHANNELS,
  sites,
} from '@borjie/database';

import { appendExecAudit } from '../audit.js';
import type { ActionHandler, ExecContext, ExecResult } from '../types.js';

// ─── shared enums (mirror the create handlers) ───────────────────────

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
const LICENCE_STATUSES = [
  'active',
  'pending',
  'expired',
  'surrendered',
  'cancelled',
  'disputed',
] as const;
const EMPLOYEE_STATUSES = [
  'active',
  'suspended',
  'on_leave',
  'terminated',
] as const;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Merge a free-form provenance/locality patch into an existing jsonb bag
 * without dropping prior keys. Records who edited it + when, plus any
 * caller-supplied locality. Pure — returns a NEW object (no mutation).
 */
function mergeJsonbBag(
  existing: Readonly<Record<string, unknown>> | null | undefined,
  ctx: ExecContext,
  extra: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  return {
    ...(existing ?? {}),
    ...extra,
    editedVia: 'chat',
    editedBy: ctx.userId,
    editedAt: new Date().toISOString(),
  };
}

// ─── update_site ─────────────────────────────────────────────────────

const updateSiteSchema = z
  .object({
    id: z.string().trim().min(1).max(80),
    name: z.string().trim().min(1).max(200).optional(),
    mineral: z.string().trim().min(1).max(120).optional(),
    status: z.enum(SITE_STATUSES).optional(),
    phase: z.enum(SITE_PHASES).optional(),
    district: z.string().trim().min(1).max(200).optional(),
    region: z.string().trim().min(1).max(200).optional(),
  })
  .refine(
    (d) =>
      d.name !== undefined ||
      d.mineral !== undefined ||
      d.status !== undefined ||
      d.phase !== undefined ||
      d.district !== undefined ||
      d.region !== undefined,
    { message: 'update_site requires at least one field to change', path: ['id'] },
  );

export const updateSiteHandler: ActionHandler = async (
  rawInput: unknown,
  ctx: ExecContext,
): Promise<ExecResult> => {
  const input = updateSiteSchema.parse(rawInput);

  // Read the current attributes so we MERGE (never clobber) the jsonb bag.
  const current = await ctx.db
    .select({ id: sites.id, attributes: sites.attributes })
    .from(sites)
    .where(and(eq(sites.tenantId, ctx.tenantId), eq(sites.id, input.id)))
    .limit(1);
  if (!current[0]) {
    throw new Error(`update_site_not_found:${input.id}`);
  }

  const localityPatch: Record<string, unknown> = {
    ...(input.district ? { district: input.district } : {}),
    ...(input.region ? { region: input.region } : {}),
  };
  const attributes = mergeJsonbBag(
    current[0].attributes as Record<string, unknown>,
    ctx,
    localityPatch,
  );

  const updated = await ctx.db
    .update(sites)
    .set({
      ...(input.name ? { name: input.name } : {}),
      ...(input.mineral ? { mineral: input.mineral } : {}),
      ...(input.status ? { status: input.status } : {}),
      ...(input.phase ? { phase: input.phase } : {}),
      attributes,
      updatedAt: new Date(),
    })
    .where(and(eq(sites.tenantId, ctx.tenantId), eq(sites.id, input.id)))
    .returning({ id: sites.id, name: sites.name, status: sites.status });

  const row = updated[0];
  if (!row) {
    throw new Error(`update_site_not_found:${input.id}`);
  }

  await appendExecAudit(ctx, {
    action: 'mining.site.update',
    turnId: String(row.id),
    details: {
      siteId: String(row.id),
      changed: Object.keys(input).filter((k) => k !== 'id'),
      status: String(row.status),
      source: 'chat-confirm-action',
    },
  });

  ctx.logger.info?.(
    { executor: 'update_site', tenantId: ctx.tenantId, siteId: row.id },
    'action-executor: site updated',
  );

  return {
    kind: 'site',
    id: String(row.id),
    summary: `Site "${String(row.name)}" updated`,
    data: { siteId: String(row.id), name: String(row.name), status: String(row.status) },
  };
};

// ─── update_employee ─────────────────────────────────────────────────

const updateEmployeeSchema = z
  .object({
    id: z.string().trim().min(1).max(80),
    name: z.string().trim().min(1).max(200).optional(),
    role: z.string().trim().min(1).max(120).optional(),
    siteId: z.string().trim().min(1).max(80).optional(),
    status: z.enum(EMPLOYEE_STATUSES).optional(),
    startDate: z.string().trim().regex(ISO_DATE_RE, 'startDate must be ISO (YYYY-MM-DD)').optional(),
  })
  .refine(
    (d) =>
      d.name !== undefined ||
      d.role !== undefined ||
      d.siteId !== undefined ||
      d.status !== undefined ||
      d.startDate !== undefined,
    { message: 'update_employee requires at least one field to change', path: ['id'] },
  );

/** Verify an optional site re-posting belongs to the tenant. Throws otherwise. */
async function resolveTenantSite(ctx: ExecContext, siteId: string): Promise<string> {
  const owned = await ctx.db
    .select({ id: sites.id })
    .from(sites)
    .where(and(eq(sites.tenantId, ctx.tenantId), eq(sites.id, siteId)))
    .limit(1);
  if (!owned[0]) {
    throw new Error(`update_employee_site_not_found:${siteId}`);
  }
  return String(owned[0].id);
}

export const updateEmployeeHandler: ActionHandler = async (
  rawInput: unknown,
  ctx: ExecContext,
): Promise<ExecResult> => {
  const input = updateEmployeeSchema.parse(rawInput);

  // Verify the optional site re-posting is the tenant's BEFORE the UPDATE so a
  // bad FK fails precisely rather than as a raw constraint violation.
  const siteId = input.siteId ? await resolveTenantSite(ctx, input.siteId) : undefined;

  const updated = await ctx.db
    .update(employees)
    .set({
      ...(input.name ? { fullName: input.name } : {}),
      ...(input.role ? { role: input.role } : {}),
      ...(siteId ? { siteId } : {}),
      ...(input.status ? { status: input.status } : {}),
      ...(input.startDate ? { startDate: input.startDate } : {}),
      // wage_rate_tzs (the ONLY money column) is NEVER patched here.
    })
    .where(and(eq(employees.tenantId, ctx.tenantId), eq(employees.id, input.id)))
    .returning({ id: employees.id, fullName: employees.fullName, role: employees.role });

  const row = updated[0];
  if (!row) {
    throw new Error(`update_employee_not_found:${input.id}`);
  }

  await appendExecAudit(ctx, {
    action: 'workforce.employee.update',
    turnId: String(row.id),
    details: {
      employeeId: String(row.id),
      changed: Object.keys(input).filter((k) => k !== 'id'),
      source: 'chat-confirm-action',
    },
  });

  ctx.logger.info?.(
    { executor: 'update_employee', tenantId: ctx.tenantId, employeeId: row.id },
    'action-executor: employee updated',
  );

  return {
    kind: 'employee',
    id: String(row.id),
    summary: `Employee "${String(row.fullName)}" updated`,
    data: { employeeId: String(row.id), fullName: String(row.fullName), role: String(row.role) },
  };
};

// ─── update_licence ──────────────────────────────────────────────────

const updateLicenceSchema = z
  .object({
    id: z.string().trim().min(1).max(80),
    number: z.string().trim().min(1).max(120).optional(),
    status: z.enum(LICENCE_STATUSES).optional(),
    expiresAt: z.string().trim().regex(ISO_DATE_RE, 'expiresAt must be ISO (YYYY-MM-DD)').optional(),
    authority: z.string().trim().min(1).max(200).optional(),
  })
  .refine(
    (d) =>
      d.number !== undefined ||
      d.status !== undefined ||
      d.expiresAt !== undefined ||
      d.authority !== undefined,
    { message: 'update_licence requires at least one field to change', path: ['id'] },
  );

export const updateLicenceHandler: ActionHandler = async (
  rawInput: unknown,
  ctx: ExecContext,
): Promise<ExecResult> => {
  const input = updateLicenceSchema.parse(rawInput);

  // Read current obligations so we MERGE the authority/provenance bag (the `fees`
  // money jsonb is NEVER touched).
  const current = await ctx.db
    .select({ id: licences.id, obligations: licences.obligations })
    .from(licences)
    .where(and(eq(licences.tenantId, ctx.tenantId), eq(licences.id, input.id)))
    .limit(1);
  if (!current[0]) {
    throw new Error(`update_licence_not_found:${input.id}`);
  }

  const obligations = mergeJsonbBag(
    current[0].obligations as Record<string, unknown>,
    ctx,
    input.authority ? { authority: input.authority } : {},
  );

  const updated = await ctx.db
    .update(licences)
    .set({
      ...(input.number ? { number: input.number } : {}),
      ...(input.status ? { status: input.status } : {}),
      ...(input.expiresAt ? { expiryDate: input.expiresAt } : {}),
      obligations,
      updatedAt: new Date(),
      // `fees` (the money jsonb) is NEVER written here.
    })
    .where(and(eq(licences.tenantId, ctx.tenantId), eq(licences.id, input.id)))
    .returning({ id: licences.id, kind: licences.kind, number: licences.number, status: licences.status });

  const row = updated[0];
  if (!row) {
    throw new Error(`update_licence_not_found:${input.id}`);
  }

  await appendExecAudit(ctx, {
    action: 'mining.licence.update',
    turnId: String(row.id),
    details: {
      licenceId: String(row.id),
      changed: Object.keys(input).filter((k) => k !== 'id'),
      status: String(row.status),
      source: 'chat-confirm-action',
    },
  });

  ctx.logger.info?.(
    { executor: 'update_licence', tenantId: ctx.tenantId, licenceId: row.id },
    'action-executor: licence updated',
  );

  return {
    kind: 'licence',
    id: String(row.id),
    summary: `Licence ${String(row.kind)} ${String(row.number)} updated`,
    data: {
      licenceId: String(row.id),
      type: String(row.kind),
      number: String(row.number),
      status: String(row.status),
    },
  };
};

// ─── update_production ───────────────────────────────────────────────

const updateProductionSchema = z
  .object({
    id: z.string().trim().min(1).max(80),
    mineral: z.string().trim().min(1).max(120).optional(),
    quantity: z.number().finite().nonnegative().optional(),
    unit: z.string().trim().min(1).max(40).optional(),
  })
  .refine(
    (d) => d.mineral !== undefined || d.quantity !== undefined || d.unit !== undefined,
    { message: 'update_production requires at least one field to change', path: ['id'] },
  );

export const updateProductionHandler: ActionHandler = async (
  rawInput: unknown,
  ctx: ExecContext,
): Promise<ExecResult> => {
  const input = updateProductionSchema.parse(rawInput);

  // Read the current `grade` jsonb (mineral/quantity/unit live here) so we MERGE
  // rather than clobber. production_records has NO money column.
  const current = await ctx.db
    .select({ id: productionRecords.id, grade: productionRecords.grade })
    .from(productionRecords)
    .where(and(eq(productionRecords.tenantId, ctx.tenantId), eq(productionRecords.id, input.id)))
    .limit(1);
  if (!current[0]) {
    throw new Error(`update_production_not_found:${input.id}`);
  }

  const grade = mergeJsonbBag(current[0].grade as Record<string, unknown>, ctx, {
    ...(input.mineral !== undefined ? { mineral: input.mineral } : {}),
    ...(input.quantity !== undefined ? { quantity: input.quantity } : {}),
    ...(input.unit !== undefined ? { unit: input.unit } : {}),
  });

  const updated = await ctx.db
    .update(productionRecords)
    .set({
      grade,
      // `mass_kg` is the canonical numeric magnitude (NOT a money column). When
      // the owner edits the quantity, keep it in sync. Drizzle numeric ⇒ string.
      ...(input.quantity !== undefined ? { massKg: String(input.quantity) } : {}),
    })
    .where(and(eq(productionRecords.tenantId, ctx.tenantId), eq(productionRecords.id, input.id)))
    .returning({ id: productionRecords.id, siteId: productionRecords.siteId });

  const row = updated[0];
  if (!row) {
    throw new Error(`update_production_not_found:${input.id}`);
  }

  await appendExecAudit(ctx, {
    action: 'mining.production.update',
    turnId: String(row.id),
    details: {
      productionRecordId: String(row.id),
      siteId: String(row.siteId),
      changed: Object.keys(input).filter((k) => k !== 'id'),
      source: 'chat-confirm-action',
    },
  });

  ctx.logger.info?.(
    { executor: 'update_production', tenantId: ctx.tenantId, productionRecordId: row.id },
    'action-executor: production updated',
  );

  return {
    kind: 'production_record',
    id: String(row.id),
    summary: `Production record ${String(row.id)} updated`,
    data: { productionRecordId: String(row.id), siteId: String(row.siteId) },
  };
};

// ─── update_reminder ─────────────────────────────────────────────────

const updateReminderSchema = z
  .object({
    reminderId: z.string().uuid(),
    title: z.string().trim().min(1).max(280).optional(),
    body: z.string().trim().min(1).max(8000).optional(),
    channel: z.enum(REMINDER_CHANNELS).optional(),
  })
  .refine(
    (d) => d.title !== undefined || d.body !== undefined || d.channel !== undefined,
    { message: 'update_reminder requires at least one field to change', path: ['reminderId'] },
  );

/**
 * Edit a SCHEDULED reminder's title / body / channel. Only a `scheduled`
 * reminder owned by the caller is mutable — a sent / cancelled / failed reminder
 * is immutable (matches the snooze handler's IMMUTABLE_STATUS guard). Constrained
 * by tenant + owner + status so a stale GUC can never surface another row.
 */
export const updateReminderHandler: ActionHandler = async (
  rawInput: unknown,
  ctx: ExecContext,
): Promise<ExecResult> => {
  const input = updateReminderSchema.parse(rawInput);

  const existing = await ctx.db
    .select({ id: reminders.id, status: reminders.status })
    .from(reminders)
    .where(
      and(
        eq(reminders.tenantId, ctx.tenantId),
        eq(reminders.ownerId, ctx.userId),
        eq(reminders.id, input.reminderId),
      ),
    )
    .limit(1);
  if (!existing[0]) {
    throw new Error(`update_reminder_not_found:${input.reminderId}`);
  }
  if (existing[0].status !== 'scheduled') {
    throw new Error(`cannot edit a ${String(existing[0].status)} reminder`);
  }

  const updated = await ctx.db
    .update(reminders)
    .set({
      ...(input.title ? { title: input.title } : {}),
      ...(input.body ? { body: input.body } : {}),
      ...(input.channel ? { channel: input.channel } : {}),
    })
    .where(
      and(
        eq(reminders.tenantId, ctx.tenantId),
        eq(reminders.ownerId, ctx.userId),
        eq(reminders.id, input.reminderId),
        eq(reminders.status, 'scheduled'),
      ),
    )
    .returning({ id: reminders.id, title: reminders.title });

  const row = updated[0];
  if (!row) {
    throw new Error(`update_reminder_not_found:${input.reminderId}`);
  }

  await appendExecAudit(ctx, {
    action: 'owner.reminder.update',
    turnId: String(row.id),
    details: {
      reminderId: String(row.id),
      changed: Object.keys(input).filter((k) => k !== 'reminderId'),
      source: 'chat-confirm-action',
    },
  });

  ctx.logger.info?.(
    { executor: 'update_reminder', tenantId: ctx.tenantId, reminderId: row.id },
    'action-executor: reminder updated',
  );

  return {
    kind: 'reminder',
    id: String(row.id),
    summary: `Reminder "${String(row.title)}" updated`,
    data: { reminderId: String(row.id), title: String(row.title) },
  };
};
