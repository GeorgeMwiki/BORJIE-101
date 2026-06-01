/**
 * add_employee — a CONFIRM-REQUIRED domain verb.
 *
 * Inserts a real row into the canonical `employees` table (the HR record
 * of an individual worker — see packages/database workforce.schema.ts;
 * read by routes/field/workforce.hono.ts). A chat-created employee is
 * indistinguishable from a form-created one downstream: same id strategy
 * (randomUUID), same required columns, same column defaults.
 *
 * This verb NEVER auto-executes. It is registered `autoSafe:false`
 * (registry.ts) so the brain-teach auto-execute path and `/micro-action`
 * both refuse it; ONLY `/confirm-action` (after the owner explicitly
 * confirmed via a confirmation_card) reaches this handler, and only after
 * the fail-closed `decideAutoAuthorization` gate authorizes it.
 *
 * MONEY BOUNDARY (CLAUDE.md hard rule): the `employees` row itself is an
 * HR record, not a ledger entry, so we use the domain repo directly (NO
 * LedgerService). But it carries ONE money column — `wage_rate_tzs`. We
 * DELIBERATELY do NOT set it from chat: a wage rate is a money figure that
 * must not be created on an auto-safe-style typed string, and setting it
 * here would touch the money path. It is nullable in the schema, so we
 * leave it unset; the owner sets the wage via the dedicated workforce
 * surface. This is the one field we flag (see the wave return notes).
 *
 * REQUIRED FK the owner cannot type from chat — `company_id` (an employee
 * belongs to a company; NOT NULL). We resolve it from the tenant's
 * most-recent company when omitted; if the tenant has no company on file
 * we fail precisely (`add_employee_requires_company`) rather than guess.
 *
 * RLS FORCE: the `/confirm-action` databaseMiddleware binds
 * `app.current_tenant_id`, so the WITH CHECK policy clips the insert to
 * the caller's tenant. We ALSO set `tenantId: ctx.tenantId` on the insert
 * and predicate the company / site lookups on the bound tenant
 * (belt-and-braces, matching the reminders handler).
 */

import { randomUUID } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';

import { companies, employees, sites } from '@borjie/database';

import { appendExecAudit } from '../audit.js';
import type { ActionHandler, ExecContext, ExecResult } from '../types.js';

const addEmployeeSchema = z.object({
  name: z.string().trim().min(1).max(200),
  /** Free-form role label (NOT NULL in schema; defaults to 'worker'). */
  role: z.string().trim().min(1).max(120).optional(),
  /** Optional site posting (nullable FK; verified to belong to tenant). */
  siteId: z.string().trim().min(1).max(80).optional(),
  /** ISO-8601 date (YYYY-MM-DD). Optional; column is nullable. */
  startDate: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'startDate must be an ISO date (YYYY-MM-DD)')
    .optional(),
  /** Optional explicit company; else resolved to the tenant's latest. */
  companyId: z.string().trim().min(1).max(80).optional(),
});

/**
 * Resolve the company the new employee belongs to. Uses the
 * caller-supplied id when present (verified to belong to the tenant), else
 * the tenant's most-recent company. Throws a precise error when neither
 * resolves so the dispatcher surfaces a clear `reason` instead of a raw
 * FK violation.
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
      throw new Error(`add_employee_company_not_found:${explicit}`);
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
    throw new Error('add_employee_requires_company');
  }
  return String(latest[0].id);
}

/** Verify an optional site posting belongs to the tenant. Returns the id
 *  or null. Throws when an explicit site does not belong to the tenant. */
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
    throw new Error(`add_employee_site_not_found:${explicit}`);
  }
  return String(owned[0].id);
}

export const addEmployeeHandler: ActionHandler = async (
  rawInput: unknown,
  ctx: ExecContext,
): Promise<ExecResult> => {
  const input = addEmployeeSchema.parse(rawInput);
  const companyId = await resolveCompanyId(ctx, input.companyId);
  const siteId = await resolveSiteId(ctx, input.siteId);

  const id = randomUUID();

  const inserted = await ctx.db
    .insert(employees)
    .values({
      id,
      tenantId: ctx.tenantId,
      companyId,
      userId: null,
      siteId,
      fullName: input.name,
      role: input.role ?? 'worker',
      // wageBasis / employmentType / nationality / status all have safe DB
      // defaults — and `wage_rate_tzs` (the ONLY money column) is left
      // UNSET on purpose so chat never writes a wage figure (money path).
      ...(input.startDate ? { startDate: input.startDate } : {}),
      attributes: { via: 'chat', createdBy: ctx.userId },
    })
    .returning({
      id: employees.id,
      fullName: employees.fullName,
      role: employees.role,
    });

  const row = inserted[0];
  if (!row) {
    throw new Error('employee insert returned no row');
  }

  await appendExecAudit(ctx, {
    action: 'workforce.employee.create',
    turnId: String(row.id),
    details: {
      employeeId: String(row.id),
      fullName: input.name,
      role: String(row.role),
      companyId,
      siteId,
      source: 'chat-confirm-action',
    },
  });

  ctx.logger.info?.(
    {
      executor: 'add_employee',
      tenantId: ctx.tenantId,
      employeeId: row.id,
      companyId,
    },
    'action-executor: employee created',
  );

  return {
    kind: 'employee',
    id: String(row.id),
    summary: `Employee "${input.name}" added as ${String(row.role)}`,
    data: {
      employeeId: String(row.id),
      fullName: input.name,
      role: String(row.role),
      companyId,
      ...(siteId ? { siteId } : {}),
    },
  };
};
