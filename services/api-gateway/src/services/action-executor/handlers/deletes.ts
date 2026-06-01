/**
 * DELETE / ARCHIVE verbs — CONFIRM-REQUIRED, SOFT-delete by construction.
 *
 *   archive_site      — archive a `sites` row        (status → 'abandoned').
 *   remove_employee   — off-board an `employees` row (status → 'terminated').
 *   void_licence      — void a `licences` row        (status → 'cancelled').
 *   delete_production — void a `production_records` row (grade.voided marker).
 *   cancel_reminder   — cancel a `reminders` row     (status → 'cancelled').
 *
 * These complete the "Mr. Mwikila can REMOVE anything" half of universal MD
 * power. EVERY verb is a SOFT-delete that PRESERVES the row (CLAUDE.md
 * append-only / auditability spirit): we flip a status / write a voided marker
 * rather than issue a hard `DELETE`, so the immutable audit trail and any
 * downstream references stay intact and the action is reversible.
 *
 * Each verb NEVER auto-executes. All are registered `autoSafe:false`
 * (registry.ts) so the brain-teach auto-execute path and `/micro-action` both
 * refuse them; ONLY `/confirm-action` (after the owner explicitly confirmed via a
 * confirmation_card) reaches these handlers, and only after the fail-closed
 * `decideAutoAuthorization` gate authorizes it.
 *
 * MONEY BOUNDARY (CLAUDE.md hard rule). None of these write a money column:
 *   - sites / production_records have no money column.
 *   - employees carry `wage_rate_tzs` — NEVER touched here (status flip only).
 *   - licences carry a `fees` jsonb — NEVER touched here (status flip only).
 *   - reminders are non-money calendar items.
 * None import LedgerService; none write a ledger/journal row.
 *
 * TENANT SCOPING: the `/confirm-action` databaseMiddleware binds
 * `app.current_tenant_id`, so RLS clips every UPDATE to the caller's tenant. We
 * ALSO predicate every `UPDATE … WHERE tenant_id = ctx.tenantId AND id = …`
 * (belt-and-braces per CLAUDE.md) — a cross-tenant id matches zero rows and the
 * handler fails precisely (`*_not_found`) instead of touching another tenant's
 * row. Reminders additionally constrain by `owner_id`.
 *
 * Every successful soft-delete appends a hash-chained `ai_audit_chain` entry via
 * `appendExecAudit` (action `*.archive|remove|void|cancel`).
 */

import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import {
  employees,
  licences,
  productionRecords,
  reminders,
  sites,
} from '@borjie/database';

import { appendExecAudit } from '../audit.js';
import type { ActionHandler, ExecContext, ExecResult } from '../types.js';

const idSchema = z.object({ id: z.string().trim().min(1).max(80) });

// ─── archive_site ────────────────────────────────────────────────────

export const archiveSiteHandler: ActionHandler = async (
  rawInput: unknown,
  ctx: ExecContext,
): Promise<ExecResult> => {
  const input = idSchema.parse(rawInput);

  // SOFT-delete: flip status → 'abandoned' (a documented site status), tenant
  // scoped. The row, its production history, and audit trail are preserved.
  const updated = await ctx.db
    .update(sites)
    .set({ status: 'abandoned', updatedAt: new Date() })
    .where(and(eq(sites.tenantId, ctx.tenantId), eq(sites.id, input.id)))
    .returning({ id: sites.id, name: sites.name, status: sites.status });

  const row = updated[0];
  if (!row) {
    throw new Error(`archive_site_not_found:${input.id}`);
  }

  await appendExecAudit(ctx, {
    action: 'mining.site.archive',
    turnId: String(row.id),
    details: {
      siteId: String(row.id),
      status: String(row.status),
      softDelete: true,
      source: 'chat-confirm-action',
    },
  });

  ctx.logger.info?.(
    { executor: 'archive_site', tenantId: ctx.tenantId, siteId: row.id },
    'action-executor: site archived',
  );

  return {
    kind: 'site',
    id: String(row.id),
    summary: `Site "${String(row.name)}" archived`,
    data: { siteId: String(row.id), name: String(row.name), status: String(row.status) },
  };
};

// ─── remove_employee ─────────────────────────────────────────────────

export const removeEmployeeHandler: ActionHandler = async (
  rawInput: unknown,
  ctx: ExecContext,
): Promise<ExecResult> => {
  const input = idSchema.parse(rawInput);

  // SOFT-delete: off-board via status → 'terminated'. The HR record (and its
  // wage history) is preserved; we never touch `wage_rate_tzs` (money column).
  const updated = await ctx.db
    .update(employees)
    .set({ status: 'terminated' })
    .where(and(eq(employees.tenantId, ctx.tenantId), eq(employees.id, input.id)))
    .returning({ id: employees.id, fullName: employees.fullName, status: employees.status });

  const row = updated[0];
  if (!row) {
    throw new Error(`remove_employee_not_found:${input.id}`);
  }

  await appendExecAudit(ctx, {
    action: 'workforce.employee.remove',
    turnId: String(row.id),
    details: {
      employeeId: String(row.id),
      status: String(row.status),
      softDelete: true,
      source: 'chat-confirm-action',
    },
  });

  ctx.logger.info?.(
    { executor: 'remove_employee', tenantId: ctx.tenantId, employeeId: row.id },
    'action-executor: employee removed',
  );

  return {
    kind: 'employee',
    id: String(row.id),
    summary: `Employee "${String(row.fullName)}" off-boarded`,
    data: { employeeId: String(row.id), fullName: String(row.fullName), status: String(row.status) },
  };
};

// ─── void_licence ────────────────────────────────────────────────────

export const voidLicenceHandler: ActionHandler = async (
  rawInput: unknown,
  ctx: ExecContext,
): Promise<ExecResult> => {
  const input = idSchema.parse(rawInput);

  // SOFT-delete: status → 'cancelled' (a documented licence status). The
  // regulatory title and its history are preserved; `fees` is never touched.
  const updated = await ctx.db
    .update(licences)
    .set({ status: 'cancelled', updatedAt: new Date() })
    .where(and(eq(licences.tenantId, ctx.tenantId), eq(licences.id, input.id)))
    .returning({ id: licences.id, kind: licences.kind, number: licences.number, status: licences.status });

  const row = updated[0];
  if (!row) {
    throw new Error(`void_licence_not_found:${input.id}`);
  }

  await appendExecAudit(ctx, {
    action: 'mining.licence.void',
    turnId: String(row.id),
    details: {
      licenceId: String(row.id),
      status: String(row.status),
      softDelete: true,
      source: 'chat-confirm-action',
    },
  });

  ctx.logger.info?.(
    { executor: 'void_licence', tenantId: ctx.tenantId, licenceId: row.id },
    'action-executor: licence voided',
  );

  return {
    kind: 'licence',
    id: String(row.id),
    summary: `Licence ${String(row.kind)} ${String(row.number)} voided`,
    data: {
      licenceId: String(row.id),
      type: String(row.kind),
      number: String(row.number),
      status: String(row.status),
    },
  };
};

// ─── delete_production ───────────────────────────────────────────────

export const deleteProductionHandler: ActionHandler = async (
  rawInput: unknown,
  ctx: ExecContext,
): Promise<ExecResult> => {
  const input = idSchema.parse(rawInput);

  // production_records has NO status column and NO money column. SOFT-delete by
  // stamping a `voided` marker into the flexible `grade` jsonb so the row (and
  // its mass_kg history) survives for audit — we never hard-DELETE it. Read the
  // current grade first so we MERGE rather than clobber.
  const current = await ctx.db
    .select({ id: productionRecords.id, grade: productionRecords.grade, siteId: productionRecords.siteId })
    .from(productionRecords)
    .where(and(eq(productionRecords.tenantId, ctx.tenantId), eq(productionRecords.id, input.id)))
    .limit(1);
  if (!current[0]) {
    throw new Error(`delete_production_not_found:${input.id}`);
  }

  const grade: Record<string, unknown> = {
    ...((current[0].grade as Record<string, unknown>) ?? {}),
    voided: true,
    voidedVia: 'chat',
    voidedBy: ctx.userId,
    voidedAt: new Date().toISOString(),
  };

  const updated = await ctx.db
    .update(productionRecords)
    .set({ grade })
    .where(and(eq(productionRecords.tenantId, ctx.tenantId), eq(productionRecords.id, input.id)))
    .returning({ id: productionRecords.id, siteId: productionRecords.siteId });

  const row = updated[0];
  if (!row) {
    throw new Error(`delete_production_not_found:${input.id}`);
  }

  await appendExecAudit(ctx, {
    action: 'mining.production.delete',
    turnId: String(row.id),
    details: {
      productionRecordId: String(row.id),
      siteId: String(row.siteId),
      softDelete: true,
      source: 'chat-confirm-action',
    },
  });

  ctx.logger.info?.(
    { executor: 'delete_production', tenantId: ctx.tenantId, productionRecordId: row.id },
    'action-executor: production voided',
  );

  return {
    kind: 'production_record',
    id: String(row.id),
    summary: `Production record ${String(row.id)} voided`,
    data: { productionRecordId: String(row.id), siteId: String(row.siteId), voided: true },
  };
};

// ─── cancel_reminder ─────────────────────────────────────────────────

const cancelReminderSchema = z.object({ reminderId: z.string().uuid() });

export const cancelReminderHandler: ActionHandler = async (
  rawInput: unknown,
  ctx: ExecContext,
): Promise<ExecResult> => {
  const input = cancelReminderSchema.parse(rawInput);

  // Only a `scheduled` reminder owned by the caller can be cancelled — a sent /
  // failed / already-cancelled reminder is immutable. Constrained by tenant +
  // owner + status so a stale GUC can never surface another tenant's row.
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
    throw new Error(`cancel_reminder_not_found:${input.reminderId}`);
  }
  if (existing[0].status !== 'scheduled') {
    throw new Error(`cannot cancel a ${String(existing[0].status)} reminder`);
  }

  const updated = await ctx.db
    .update(reminders)
    .set({ status: 'cancelled' })
    .where(
      and(
        eq(reminders.tenantId, ctx.tenantId),
        eq(reminders.ownerId, ctx.userId),
        eq(reminders.id, input.reminderId),
        eq(reminders.status, 'scheduled'),
      ),
    )
    .returning({ id: reminders.id, title: reminders.title, status: reminders.status });

  const row = updated[0];
  if (!row) {
    throw new Error(`cancel_reminder_not_found:${input.reminderId}`);
  }

  await appendExecAudit(ctx, {
    action: 'owner.reminder.cancel',
    turnId: String(row.id),
    details: {
      reminderId: String(row.id),
      status: String(row.status),
      softDelete: true,
      source: 'chat-confirm-action',
    },
  });

  ctx.logger.info?.(
    { executor: 'cancel_reminder', tenantId: ctx.tenantId, reminderId: row.id },
    'action-executor: reminder cancelled',
  );

  return {
    kind: 'reminder',
    id: String(row.id),
    summary: `Reminder "${String(row.title)}" cancelled`,
    data: { reminderId: String(row.id), title: String(row.title), status: String(row.status) },
  };
};
