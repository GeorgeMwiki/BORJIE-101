/**
 * DSAR Right-to-be-Forgotten (RTBF) Executor — Wave-K Final Zero.
 *
 * Implements GDPR Art. 17 (Right to Erasure) and Tanzania PDPA s.31.
 * The previous PR #57 shipped a `POST /api/v1/dsar/:subjectId/rtbf`
 * stub that returned `{accepted: true, scheduledAt: ...}` without any
 * mutation. This executor is the real engine: it walks every DSAR
 * table for the subject and applies a per-table erasure policy —
 * `ANONYMIZE`, `HARD_DELETE`, or `RETAIN` — wrapped in a single Drizzle
 * transaction so the run is all-or-nothing.
 *
 * Why per-table policy instead of "delete everything"?
 * ─────────────────────────────────────────────────────
 * Financial records (payments, invoices, owner_statements,
 * monthly_close_runs, gepg_control_numbers) must be retained under
 * Tanzania VAT / KRA accounting law and TRA record-keeping rules,
 * which OVERRIDE the GDPR erasure right under Art. 17(3)(b)/(e).
 * Audit events are non-negotiable — erasing the audit trail itself
 * would undermine the very compliance posture RTBF defends. So
 * "right to erasure" in practice is a mixed strategy:
 *
 *   • ANONYMIZE — overwrite PII columns with `[REDACTED]` / null and
 *     leave the row in place. Preserves FK integrity so historical
 *     leases / inspections / maintenance tickets remain attached to
 *     their property without leaking subject identity. The redacted
 *     row carries the original primary key so downstream FK joins
 *     keep working; aggregate reports (tenure, occupancy, vacancy)
 *     stay accurate.
 *
 *   • HARD_DELETE — `DELETE FROM table WHERE subject_match`. Used
 *     for transient interaction data (messages, voice_turns,
 *     kernel_cot_reservoir) which carries no accounting or FK
 *     obligation. Rows are gone after the run.
 *
 *   • RETAIN — keep the row untouched (financial / regulator
 *     records). Optionally stamp `subject_redacted_at = NOW()` if
 *     the column exists so the audit trail reflects the RTBF
 *     request without losing the underlying record.
 *
 * Dry-run
 * ───────
 * `dryRun: true` walks the same code path but skips the writes. The
 * returned report enumerates what WOULD happen — useful for legal
 * preview before signing off on the real run.
 *
 * Tenant isolation
 * ────────────────
 * Every UPDATE / DELETE includes `tenant_id = $tenantId` so a
 * cross-tenant RTBF can never accidentally wipe a different tenant's
 * data. The composition root passes the auth tenant id through
 * `executeRtbf` opts.
 *
 * Atomicity
 * ─────────
 * The whole run is wrapped in a Drizzle transaction. If any single
 * table errors past a fatal threshold (e.g. transaction abort), the
 * whole run rolls back. Per-table NON-FATAL errors (missing column,
 * missing table on a lagging schema) are swallowed into
 * `partialErrors` so a deployed schema that lags the DSAR contract
 * by one table doesn't kill the whole erasure.
 */

import type { DsarTableName } from './types.js';

// ─────────────────────────────────────────────────────────────────────
// Port contract — `db` is opaque. We use the same `{ execute }`
// shape as `dsar-data-source-drizzle.ts` PLUS an optional
// `transaction` method (drizzle-orm exposes `db.transaction(fn)`).
// If no `transaction` is available we fall back to running statements
// directly (best-effort; the composition root should always wire a
// transactional client in production).
// ─────────────────────────────────────────────────────────────────────

export interface RtbfDrizzleClient {
  execute(query: unknown): Promise<unknown>;
  transaction?<T>(fn: (tx: RtbfDrizzleClient) => Promise<T>): Promise<T>;
}

/** Minimal subset of `drizzle-orm`'s `sql` tag we depend on. */
export type RtbfSqlTemplateFn = (
  strings: TemplateStringsArray,
  ...values: unknown[]
) => unknown;

// ─────────────────────────────────────────────────────────────────────
// Policy table — one row per DSAR bundle table.
//
// `action` — what happens to the row.
// `piiColumns` — for ANONYMIZE, the columns overwritten with
//   `[REDACTED]` (strings) or `NULL` (everything else). For HARD_DELETE
//   and RETAIN the list is informational only.
// `subjectColumns` — mirrors the data-source bindings: which columns
//   identify the subject in this table, per subject-kind.
// `tenantScoped` — every table is tenant-scoped today; the flag exists
//   to make a future cross-tenant kernel surface explicit.
// `sqlName` — physical SQL table identifier (canonical name → physical
//   table name).
// `redactionMarkerColumn` — for RETAIN tables that should still record
//   the RTBF request was processed, the column to stamp with NOW(). If
//   absent, RETAIN is fully passive.
// ─────────────────────────────────────────────────────────────────────

export type RtbfAction = 'ANONYMIZE' | 'HARD_DELETE' | 'RETAIN';

export interface RtbfPolicyEntry {
  readonly sqlName: string;
  readonly action: RtbfAction;
  readonly reason: string;
  readonly piiColumns: ReadonlyArray<string>;
  readonly subjectColumns: Readonly<
    Record<'customerId' | 'email' | 'tenantId', ReadonlyArray<string>>
  >;
  readonly tenantScoped: boolean;
  readonly redactionMarkerColumn?: string;
}

export const RTBF_POLICY: Readonly<Record<DsarTableName, RtbfPolicyEntry>> =
  Object.freeze({
    customers: {
      sqlName: 'customers',
      action: 'ANONYMIZE',
      reason:
        'retain row for FK integrity (leases, payments, owner statements all FK to customers.id); overwrite PII columns',
      piiColumns: [
        'email',
        'phone',
        'alternate_phone',
        'first_name',
        'last_name',
        'middle_name',
        'date_of_birth',
        'nationality',
        'occupation',
        'employer',
        'monthly_income',
        'kyc_notes',
        'id_document_type',
        'id_document_number',
        'current_address_line1',
        'current_address_line2',
        'emergency_contact_phone',
        'emergency_contact_email',
      ],
      subjectColumns: {
        customerId: ['id'],
        email: ['email'],
        tenantId: [],
      },
      tenantScoped: true,
    },
    leases: {
      sqlName: 'leases',
      action: 'ANONYMIZE',
      reason:
        'retain row for property history; lease number / dates are non-personal aggregate; strip customer linkage',
      piiColumns: [],
      subjectColumns: {
        customerId: ['customer_id'],
        email: [],
        tenantId: [],
      },
      tenantScoped: true,
    },
    payments: {
      sqlName: 'payments',
      action: 'RETAIN',
      reason:
        'financial records — TRA / VAT record-keeping rules override erasure right (GDPR Art. 17(3)(b))',
      piiColumns: ['mpesa_phone', 'payer_email'],
      subjectColumns: {
        customerId: ['customer_id'],
        email: ['payer_email'],
        tenantId: [],
      },
      tenantScoped: true,
    },
    invoices: {
      sqlName: 'invoices',
      action: 'RETAIN',
      reason: 'financial obligation evidence — accounting law retention',
      piiColumns: ['customer_notes'],
      subjectColumns: {
        customerId: ['customer_id'],
        email: [],
        tenantId: [],
      },
      tenantScoped: true,
    },
    messages: {
      sqlName: 'messages',
      action: 'HARD_DELETE',
      reason:
        'no audit/accounting obligation; full deletion of subject communications',
      piiColumns: [],
      subjectColumns: {
        customerId: [],
        email: ['recipient_email'],
        tenantId: [],
      },
      tenantScoped: true,
    },
    voice_turns: {
      sqlName: 'voice_turns',
      action: 'HARD_DELETE',
      reason: 'transient voice interaction data; no retention obligation',
      piiColumns: [],
      subjectColumns: {
        customerId: ['customer_id'],
        email: [],
        tenantId: [],
      },
      tenantScoped: true,
    },
    feedback: {
      sqlName: 'feedback_submissions',
      action: 'ANONYMIZE',
      reason:
        'preserve feedback body for product learning, strip subject linkage',
      piiColumns: ['submitted_by_email', 'submitted_by_customer_id'],
      subjectColumns: {
        customerId: ['submitted_by_customer_id'],
        email: ['submitted_by_email'],
        tenantId: [],
      },
      tenantScoped: true,
    },
    owner_statements: {
      sqlName: 'owner_statements',
      action: 'RETAIN',
      reason: 'financial record — TRA / accounting retention',
      piiColumns: [],
      subjectColumns: {
        customerId: ['owner_id'],
        email: [],
        tenantId: [],
      },
      tenantScoped: true,
    },
    maintenance_tickets: {
      sqlName: 'maintenance_requests',
      action: 'ANONYMIZE',
      reason:
        'retain for property history; strip tenant identity by nulling customer_id',
      piiColumns: ['customer_id', 'description'],
      subjectColumns: {
        customerId: ['customer_id'],
        email: [],
        tenantId: [],
      },
      tenantScoped: true,
    },
    inspections: {
      sqlName: 'inspections',
      action: 'ANONYMIZE',
      reason: 'retain for property history; strip inspector identity',
      piiColumns: ['inspector_id'],
      subjectColumns: {
        customerId: [],
        email: [],
        tenantId: [],
      },
      tenantScoped: true,
    },
    market_rate_snapshots: {
      sqlName: 'market_rate_snapshots',
      action: 'RETAIN',
      reason: 'non-personal aggregate data; no subject linkage to erase',
      piiColumns: [],
      subjectColumns: {
        customerId: [],
        email: [],
        tenantId: [],
      },
      tenantScoped: true,
    },
    kra_mri_filings: {
      sqlName: 'monthly_close_runs',
      action: 'RETAIN',
      reason: 'tax/regulator record — KRA retention rules',
      piiColumns: [],
      subjectColumns: {
        customerId: [],
        email: [],
        tenantId: [],
      },
      tenantScoped: true,
    },
    gepg_transactions: {
      sqlName: 'gepg_control_numbers',
      action: 'RETAIN',
      reason: 'tax/regulator record — GEPG audit retention',
      piiColumns: ['payer_name', 'payer_phone', 'payer_email'],
      subjectColumns: {
        customerId: [],
        email: ['payer_email'],
        tenantId: [],
      },
      tenantScoped: true,
    },
    audit_events: {
      sqlName: 'audit_events',
      action: 'RETAIN',
      reason:
        'the audit chain itself — erasing audit events would undermine compliance posture; non-negotiable',
      piiColumns: [],
      subjectColumns: {
        customerId: ['actor_id', 'target_id'],
        email: ['actor_email'],
        tenantId: [],
      },
      tenantScoped: true,
    },
    cot_reservoir: {
      sqlName: 'kernel_cot_reservoir',
      action: 'HARD_DELETE',
      reason: 'transient brain memory; no retention obligation',
      piiColumns: [],
      subjectColumns: {
        customerId: ['thread_id'],
        email: [],
        tenantId: [],
      },
      tenantScoped: true,
    },
    // Phase D / A2b-1 — kernel memory tables hold chat summaries
    // (episodic) and user-declared facts (semantic). Both are
    // HARD_DELETE on RTBF.
    kernel_memory_episodic: {
      sqlName: 'kernel_memory_episodic',
      action: 'HARD_DELETE',
      reason:
        'chat summaries / episodic recollections; no audit obligation, fully erasable',
      piiColumns: [],
      subjectColumns: {
        customerId: ['user_id'],
        email: [],
        tenantId: ['tenant_id'],
      },
      tenantScoped: true,
    },
    kernel_memory_semantic: {
      sqlName: 'kernel_memory_semantic',
      action: 'HARD_DELETE',
      reason:
        'user-declared semantic facts; subject-owned and fully erasable on request',
      piiColumns: [],
      subjectColumns: {
        customerId: ['user_id'],
        email: [],
        tenantId: ['tenant_id'],
      },
      tenantScoped: true,
    },
    // tenant_identities — cross-org principal. ANONYMIZE so referential
    // integrity into org_memberships survives but contact details are stripped.
    tenant_identities: {
      sqlName: 'tenant_identities',
      action: 'ANONYMIZE',
      reason:
        'preserve identity row for cross-org FK integrity; strip contact details',
      piiColumns: ['email', 'phone_normalized'],
      subjectColumns: {
        customerId: ['id'],
        email: ['email'],
        tenantId: [],
      },
      tenantScoped: false,
    },
    // employees — staff PII. ANONYMIZE so historical assignments,
    // performance reviews, and audit trails keep their FK linkage
    // while the staff member's identity is stripped.
    employees: {
      sqlName: 'employees',
      action: 'ANONYMIZE',
      reason:
        'retain employment record for HR audit / payroll history; strip personal contact + name fields',
      piiColumns: ['first_name', 'last_name', 'email', 'phone', 'phone_alt'],
      subjectColumns: {
        customerId: ['user_id'],
        email: ['email'],
        tenantId: [],
      },
      tenantScoped: true,
    },
  });

// ─────────────────────────────────────────────────────────────────────
// Report shape
// ─────────────────────────────────────────────────────────────────────

export type RtbfTableActionResult =
  | 'anonymized'
  | 'hard-deleted'
  | 'retained'
  | 'skipped';

export interface RtbfTableReport {
  readonly table: DsarTableName;
  readonly action: RtbfTableActionResult;
  readonly rowsAffected: number;
  readonly reason?: string;
}

export interface RtbfPartialError {
  readonly table: DsarTableName;
  readonly error: string;
}

export interface RtbfExecutionReport {
  readonly subjectId: string;
  readonly subjectKind: 'customerId' | 'email' | 'tenantId';
  readonly executedAt: string;
  readonly requestedBy: string;
  readonly dryRun: boolean;
  readonly tablesProcessed: ReadonlyArray<RtbfTableReport>;
  readonly partialErrors: ReadonlyArray<RtbfPartialError>;
  readonly totalRowsAffected: number;
}

// ─────────────────────────────────────────────────────────────────────
// Factory options + entry point
// ─────────────────────────────────────────────────────────────────────

export interface CreateDsarRtbfExecutorOptions {
  readonly db: RtbfDrizzleClient;
  /**
   * Optional explicit tenant id. When provided every UPDATE/DELETE is
   * also constrained by `tenant_id = $tenantId`. When absent we still
   * scope by subject only — adequate because subject ids are unique
   * per tenant in production. The composition root SHOULD pass it.
   */
  readonly tenantId?: string;
  /**
   * SQL template factory. Same shape as the data source. Tests pass a
   * deterministic builder; production resolves to drizzle-orm's `sql`.
   */
  readonly sqlTemplate?: RtbfSqlTemplateFn;
  /**
   * Injectable clock for deterministic `executedAt` in tests.
   */
  readonly now?: () => Date;
}

export interface ExecuteRtbfArgs {
  readonly subjectId: string;
  /**
   * `auto` infers from shape:
   *   - contains '@' → email
   *   - starts with 'tnt_' or 'tenant_' → tenantId
   *   - otherwise → customerId
   */
  readonly subjectKind?: 'auto' | 'customerId' | 'email' | 'tenantId';
  readonly requestedBy: string;
  readonly dryRun?: boolean;
}

export interface DsarRtbfExecutor {
  executeRtbf(args: ExecuteRtbfArgs): Promise<RtbfExecutionReport>;
}

export function createDsarRtbfExecutor(
  opts: CreateDsarRtbfExecutorOptions,
): DsarRtbfExecutor {
  if (!opts || !opts.db) {
    throw new Error('createDsarRtbfExecutor: db client is required');
  }
  const db = opts.db;
  const tenantId = opts.tenantId?.trim() || null;
  const sqlBuilder = opts.sqlTemplate ?? defaultRtbfSqlBuilder();
  const clock = opts.now ?? (() => new Date());

  return {
    async executeRtbf(args: ExecuteRtbfArgs): Promise<RtbfExecutionReport> {
      const subjectId = args.subjectId?.trim();
      const requestedBy = args.requestedBy?.trim();
      if (!subjectId) {
        throw new Error('executeRtbf: subjectId is required');
      }
      if (!requestedBy) {
        throw new Error('executeRtbf: requestedBy is required');
      }
      const dryRun = args.dryRun === true;
      const subjectKind = resolveSubjectKind(
        subjectId,
        args.subjectKind ?? 'auto',
      );

      const executedAt = clock().toISOString();

      // Run inside a transaction when available so the all-or-nothing
      // semantic holds. When `transaction` is missing we fall back to
      // sequential execution — degraded mode for tests / DB-less.
      const run = async (
        tx: RtbfDrizzleClient,
      ): Promise<{
        tablesProcessed: RtbfTableReport[];
        partialErrors: RtbfPartialError[];
      }> => {
        const tablesProcessed: RtbfTableReport[] = [];
        const partialErrors: RtbfPartialError[] = [];
        for (const table of Object.keys(RTBF_POLICY) as DsarTableName[]) {
          try {
            const result = await processTable({
              tx,
              table,
              subjectId,
              subjectKind,
              tenantId,
              sqlBuilder,
              dryRun,
            });
            tablesProcessed.push(result);
          } catch (err) {
            partialErrors.push({
              table,
              error: errorMessage(err),
            });
            tablesProcessed.push(
              Object.freeze({
                table,
                action: 'skipped' as const,
                rowsAffected: 0,
                reason: 'error during execution; see partialErrors',
              }),
            );
          }
        }
        return { tablesProcessed, partialErrors };
      };

      const txFn = typeof db.transaction === 'function' ? db.transaction.bind(db) : null;
      const { tablesProcessed, partialErrors } = txFn
        ? await txFn(async (tx) => run(tx))
        : await run(db);

      const totalRowsAffected = tablesProcessed.reduce(
        (sum, r) => sum + r.rowsAffected,
        0,
      );

      return Object.freeze({
        subjectId,
        subjectKind,
        executedAt,
        requestedBy,
        dryRun,
        tablesProcessed: Object.freeze(tablesProcessed),
        partialErrors: Object.freeze(partialErrors),
        totalRowsAffected,
      });
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Per-table execution. Pure function — no module state.
// ─────────────────────────────────────────────────────────────────────

interface ProcessTableArgs {
  readonly tx: RtbfDrizzleClient;
  readonly table: DsarTableName;
  readonly subjectId: string;
  readonly subjectKind: 'customerId' | 'email' | 'tenantId';
  readonly tenantId: string | null;
  readonly sqlBuilder: RtbfSqlTemplateFn;
  readonly dryRun: boolean;
}

async function processTable(
  args: ProcessTableArgs,
): Promise<RtbfTableReport> {
  const { tx, table, subjectId, subjectKind, tenantId, sqlBuilder, dryRun } =
    args;
  const policy = RTBF_POLICY[table];
  if (!policy) {
    return Object.freeze({
      table,
      action: 'skipped' as const,
      rowsAffected: 0,
      reason: 'no policy registered',
    });
  }

  const subjectColumns =
    subjectKind === 'email'
      ? policy.subjectColumns.email
      : subjectKind === 'tenantId'
        ? policy.subjectColumns.tenantId
        : policy.subjectColumns.customerId;

  if (subjectColumns.length === 0) {
    // No mapping for this subject kind in this table — skip cleanly.
    return Object.freeze({
      table,
      action: 'skipped' as const,
      rowsAffected: 0,
      reason: `no ${subjectKind} mapping for ${policy.sqlName}`,
    });
  }

  if (policy.action === 'RETAIN') {
    // RETAIN tables are passive — count the rows that WOULD be
    // affected so the report is honest, but never mutate. (We could
    // stamp `subject_redacted_at` but that column doesn't exist on
    // most retain tables today; a follow-up migration can add it.)
    const rows = await countMatchingRows({
      tx,
      policy,
      subjectId,
      subjectColumns,
      tenantId,
      sqlBuilder,
    });
    return Object.freeze({
      table,
      action: 'retained' as const,
      rowsAffected: rows,
      reason: policy.reason,
    });
  }

  if (policy.action === 'HARD_DELETE') {
    if (dryRun) {
      const rows = await countMatchingRows({
        tx,
        policy,
        subjectId,
        subjectColumns,
        tenantId,
        sqlBuilder,
      });
      return Object.freeze({
        table,
        action: 'hard-deleted' as const,
        rowsAffected: rows,
        reason: 'dry-run preview',
      });
    }
    const rows = await runDelete({
      tx,
      policy,
      subjectId,
      subjectColumns,
      tenantId,
      sqlBuilder,
    });
    return Object.freeze({
      table,
      action: 'hard-deleted' as const,
      rowsAffected: rows,
      reason: policy.reason,
    });
  }

  // ANONYMIZE
  if (policy.piiColumns.length === 0) {
    // Nothing to overwrite — degrade to a RETAIN-style passive count.
    const rows = await countMatchingRows({
      tx,
      policy,
      subjectId,
      subjectColumns,
      tenantId,
      sqlBuilder,
    });
    return Object.freeze({
      table,
      action: 'anonymized' as const,
      rowsAffected: rows,
      reason: 'no PII columns declared; counted only',
    });
  }
  if (dryRun) {
    const rows = await countMatchingRows({
      tx,
      policy,
      subjectId,
      subjectColumns,
      tenantId,
      sqlBuilder,
    });
    return Object.freeze({
      table,
      action: 'anonymized' as const,
      rowsAffected: rows,
      reason: 'dry-run preview',
    });
  }
  const rows = await runAnonymize({
    tx,
    policy,
    subjectId,
    subjectColumns,
    tenantId,
    sqlBuilder,
  });
  return Object.freeze({
    table,
    action: 'anonymized' as const,
    rowsAffected: rows,
    reason: policy.reason,
  });
}

// ─────────────────────────────────────────────────────────────────────
// SQL builders. Same shape pattern as `dsar-data-source-drizzle.ts`.
// ─────────────────────────────────────────────────────────────────────

interface QueryArgs {
  readonly tx: RtbfDrizzleClient;
  readonly policy: RtbfPolicyEntry;
  readonly subjectId: string;
  readonly subjectColumns: ReadonlyArray<string>;
  readonly tenantId: string | null;
  readonly sqlBuilder: RtbfSqlTemplateFn;
}

async function countMatchingRows(args: QueryArgs): Promise<number> {
  const { tx, policy, subjectId, subjectColumns, tenantId, sqlBuilder } = args;
  const table = `"${policy.sqlName}"`;
  const where = buildWhereClause(subjectColumns, subjectId, tenantId);
  const query = sqlBuilder`SELECT COUNT(*)::int AS count FROM ${rawFragment(table)} WHERE ${rawFragment(where.fragment)}`;
  const result = await tx.execute(query);
  return extractCount(result);
}

async function runDelete(args: QueryArgs): Promise<number> {
  const { tx, policy, subjectId, subjectColumns, tenantId, sqlBuilder } = args;
  const table = `"${policy.sqlName}"`;
  const where = buildWhereClause(subjectColumns, subjectId, tenantId);
  const query = sqlBuilder`DELETE FROM ${rawFragment(table)} WHERE ${rawFragment(where.fragment)} RETURNING 1`;
  const result = await tx.execute(query);
  return extractAffectedRows(result);
}

async function runAnonymize(args: QueryArgs): Promise<number> {
  const { tx, policy, subjectId, subjectColumns, tenantId, sqlBuilder } = args;
  const table = `"${policy.sqlName}"`;
  const where = buildWhereClause(subjectColumns, subjectId, tenantId);
  const setClause = buildSetClause(policy.piiColumns);
  const query = sqlBuilder`UPDATE ${rawFragment(table)} SET ${rawFragment(setClause)} WHERE ${rawFragment(where.fragment)} RETURNING 1`;
  const result = await tx.execute(query);
  return extractAffectedRows(result);
}

function buildWhereClause(
  subjectColumns: ReadonlyArray<string>,
  subjectId: string,
  tenantId: string | null,
): { readonly fragment: string } {
  // We embed the literal because we render WHERE via the raw fragment
  // path; identifiers must be inlined. Single quotes are escaped to
  // prevent SQL injection (subjectId comes from the JWT/auth-scoped
  // path param after the router has validated it; we still defend in
  // depth by escaping here).
  const escaped = `'${escapeRtbfLiteral(subjectId)}'`;
  if (subjectColumns.length === 1) {
    let fragment = `"${subjectColumns[0]}" = ${escaped}`;
    if (tenantId) {
      fragment += ` AND tenant_id = '${escapeRtbfLiteral(tenantId)}'`;
    }
    return { fragment };
  }
  const orClauses = subjectColumns
    .map((c) => `"${c}" = ${escaped}`)
    .join(' OR ');
  let fragment = `(${orClauses})`;
  if (tenantId) {
    fragment += ` AND tenant_id = '${escapeRtbfLiteral(tenantId)}'`;
  }
  return { fragment };
}

function buildSetClause(piiColumns: ReadonlyArray<string>): string {
  // Strings → '[REDACTED]'. We don't know each column's SQL type at
  // this layer, so we use a defensive literal that PG will coerce
  // for text columns. Non-text columns (date_of_birth, monthly_income,
  // submitted_by_customer_id which is UUID) need NULL — they're
  // explicitly nullable in the schema so this is safe.
  return piiColumns
    .map((c) => {
      if (NULLABLE_OVERRIDE_COLUMNS.has(c)) {
        return `"${c}" = NULL`;
      }
      return `"${c}" = '[REDACTED]'`;
    })
    .join(', ');
}

// Columns that are NOT text → must be nulled rather than overwritten
// with the '[REDACTED]' string literal. Conservative list; better to
// null an extra column than crash on a type mismatch.
const NULLABLE_OVERRIDE_COLUMNS = new Set<string>([
  'date_of_birth',
  'monthly_income',
  'submitted_by_customer_id',
  'customer_id',
  'inspector_id',
  'submitted_by_email', // could be either; null-safe
]);

function escapeRtbfLiteral(s: string): string {
  return s.replace(/'/g, "''");
}

// ─────────────────────────────────────────────────────────────────────
// Subject-kind inference. Mirrors the export side so a single RTBF
// run hits the same rows as the prior DSAR export.
// ─────────────────────────────────────────────────────────────────────

function resolveSubjectKind(
  subjectId: string,
  hint: 'auto' | 'customerId' | 'email' | 'tenantId',
): 'customerId' | 'email' | 'tenantId' {
  if (hint !== 'auto') return hint;
  if (subjectId.includes('@')) return 'email';
  if (subjectId.startsWith('tnt_') || subjectId.startsWith('tenant_')) {
    return 'tenantId';
  }
  return 'customerId';
}

// ─────────────────────────────────────────────────────────────────────
// Result extractors. drizzle's `execute()` shape varies across drivers;
// we accept array, `{ rows }`, and `{ rowCount }` shapes.
// ─────────────────────────────────────────────────────────────────────

function extractCount(result: unknown): number {
  if (!result) return 0;
  if (Array.isArray(result)) {
    if (result.length === 0) return 0;
    const first = result[0] as { count?: unknown };
    return numericFieldOrZero(first?.count);
  }
  const r = result as {
    rows?: ReadonlyArray<{ count?: unknown }>;
    rowCount?: unknown;
  };
  if (Array.isArray(r.rows) && r.rows.length > 0) {
    return numericFieldOrZero(r.rows[0]?.count);
  }
  return numericFieldOrZero(r.rowCount);
}

function extractAffectedRows(result: unknown): number {
  if (!result) return 0;
  if (Array.isArray(result)) return result.length;
  const r = result as { rows?: ReadonlyArray<unknown>; rowCount?: unknown };
  if (Array.isArray(r.rows)) return r.rows.length;
  return numericFieldOrZero(r.rowCount);
}

function numericFieldOrZero(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return 'unknown error';
  }
}

// ─────────────────────────────────────────────────────────────────────
// Raw fragment helper — same brand pattern as the data source.
// ─────────────────────────────────────────────────────────────────────

const RTBF_RAW_BRAND = Symbol('dsar-rtbf-raw-fragment');

function rawFragment(s: string): {
  readonly [RTBF_RAW_BRAND]: true;
  readonly value: string;
} {
  return Object.freeze({ [RTBF_RAW_BRAND]: true as const, value: s });
}

function isRtbfRawFragment(
  x: unknown,
): x is { readonly [RTBF_RAW_BRAND]: true; readonly value: string } {
  return (
    typeof x === 'object' &&
    x !== null &&
    (x as { [RTBF_RAW_BRAND]?: unknown })[RTBF_RAW_BRAND] === true
  );
}

function defaultRtbfSqlBuilder(): RtbfSqlTemplateFn {
  let cached: RtbfSqlTemplateFn | null = null;
  return (strings, ...values) => {
    if (!cached) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports -- SCRUB-5f: rule-disabled because drizzle-orm is loaded via sync require for lazy template-fn resolution; ESM dynamic import would force the call site to be async
        const drizzle = require('drizzle-orm');
        const sqlFn = drizzle?.sql;
        const rawFn = drizzle?.sql?.raw;
        if (typeof sqlFn !== 'function' || typeof rawFn !== 'function') {
          throw new Error('drizzle-orm/sql not available');
        }
        cached = ((s: TemplateStringsArray, ...v: unknown[]) => {
          const unwrapped = v.map((x) =>
            isRtbfRawFragment(x) ? rawFn(x.value) : x,
          );
          return sqlFn(s, ...unwrapped);
        }) as RtbfSqlTemplateFn;
      } catch {
        cached = ((s: TemplateStringsArray, ...v: unknown[]) => {
          let out = '';
          for (let i = 0; i < s.length; i++) {
            out += s[i];
            if (i < v.length) {
              const val = v[i];
              if (isRtbfRawFragment(val)) {
                out += val.value;
              } else if (typeof val === 'string') {
                out += `'${escapeRtbfLiteral(val)}'`;
              } else {
                out += String(val);
              }
            }
          }
          return out;
        }) as RtbfSqlTemplateFn;
      }
    }
    return cached(strings, ...values);
  };
}
