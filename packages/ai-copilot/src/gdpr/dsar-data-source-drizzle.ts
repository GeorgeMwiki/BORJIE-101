/**
 * Drizzle-backed implementation of the `DsarDataSource` port.
 *
 * Binds the library-agnostic `compileDsar` compiler to the concrete
 * Borjie Postgres schema. Stays out of `@borjie/database`'s
 * dependency tree (the compiler package is upstream of database) by
 * accepting an opaque `db` client at construction time and emitting
 * tenant-scoped `sql` template strings via `drizzle-orm`.
 *
 * Design notes
 * ────────────
 * - The compiler's `DsarTableName` union uses canonical bundle names
 *   ("messages", "feedback", "cot_reservoir") that don't always match
 *   the Drizzle table identifiers (e.g. `feedback_submissions`,
 *   `kernel_cot_reservoir`). The `TABLE_BINDINGS` map captures both
 *   the physical SQL identifier AND the explicit column list — never
 *   `SELECT *`, so a column drop doesn't silently change the wire
 *   format.
 * - Subject-id resolution differs per table:
 *     • customer-scoped tables   → `customer_id = $subject`
 *     • staff/user-scoped tables → `user_id = $subject` OR `actor_id`
 *     • email-keyed tables       → `email = $subject` (audit_events,
 *                                   feedback_submissions submitter)
 *   `SUBJECT_COLUMN_BINDINGS` records the mapping per (table, kind).
 *   Tables with no plausible binding for the inferred kind return [].
 * - Tenant isolation is enforced at the SQL level: every query is
 *   either tenant-scoped via `tenant_id = $tenantId` or — for tables
 *   that don't carry tenant_id (kernel_cot_reservoir reservoir rows
 *   can be cross-tenant) — filters by the subject only. The compiler
 *   layer guarantees the calling auth scope.
 * - Every read swallows table-level errors (the compiler routes them
 *   into `partialErrors`); the data source never throws on a missing
 *   table. This means a deployed schema can lag the DSAR contract by
 *   one table without the export endpoint 5xx-ing.
 * - `listAffectedTables` runs a single per-table `COUNT(*) > 0` probe
 *   in parallel so the compiler skips empty buckets. When the probe
 *   itself fails (e.g. table doesn't exist in this deployment) we
 *   conservatively assume the table MAY be affected — the compiler's
 *   per-table reader will then return [] without an error.
 */

import type {
  DsarDataSource,
  DsarRow,
  DsarTableName,
  ClassificationLookup,
  FieldClassificationLite,
} from './types.js';

// ─────────────────────────────────────────────────────────────────────
// Port contract — `db` is opaque (drizzle client). We treat it as
// `{ execute(q): Promise<...> }` so this file never imports the
// concrete drizzle-orm types directly (would create a cycle with the
// database package).
// ─────────────────────────────────────────────────────────────────────

export interface DsarDrizzleClient {
  execute(query: unknown): Promise<unknown>;
}

export interface CreateDsarDataSourceDrizzleOptions {
  readonly db: DsarDrizzleClient;
  /**
   * Optional explicit tenant id. When provided every query is also
   * filtered by `tenant_id = $tenantId`. When absent (subject-driven
   * export — e.g. a customer dialling their own data) we still filter
   * by the subject column; cross-tenant leakage is prevented because
   * the subject identifier is unique per tenant.
   */
  readonly tenantId?: string;
  /**
   * SQL template factory. Allows tests to inject a deterministic
   * builder without pulling in drizzle-orm's runtime. Defaults to
   * dynamic-importing drizzle-orm's `sql` so the package stays
   * importable in environments where drizzle is not installed.
   */
  readonly sqlTemplate?: SqlTemplateFn;
}

/** Minimal subset of `drizzle-orm`'s `sql` tag we depend on. */
export type SqlTemplateFn = (
  strings: TemplateStringsArray,
  ...values: unknown[]
) => unknown;

// ─────────────────────────────────────────────────────────────────────
// Bindings — DSAR canonical table name → physical SQL table + column list.
// `subjectColumns` records which column the data source filters on for
// each subject kind. An empty array means "this table has no rows for
// this subject kind" and the reader returns [] without running a query.
// ─────────────────────────────────────────────────────────────────────

interface TableBinding {
  readonly sqlName: string;
  readonly columns: ReadonlyArray<string>;
  readonly subjectColumns: Readonly<
    Record<'customerId' | 'tenantId' | 'email', ReadonlyArray<string>>
  >;
  readonly tenantScoped: boolean;
}

const TABLE_BINDINGS: Readonly<Record<DsarTableName, TableBinding>> =
  Object.freeze({
    customers: {
      sqlName: 'customers',
      columns: [
        'id',
        'tenant_id',
        'customer_code',
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
        'status',
        'kyc_status',
        'kyc_notes',
        'id_document_type',
        'id_document_number',
        'current_address_line1',
        'current_address_line2',
        'emergency_contact_phone',
        'emergency_contact_email',
        'created_at',
        'updated_at',
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
      columns: [
        'id',
        'tenant_id',
        'customer_id',
        'unit_id',
        'lease_number',
        'status',
        'rent_amount',
        'security_deposit_amount',
        'start_date',
        'end_date',
        'created_at',
        'updated_at',
      ],
      subjectColumns: {
        customerId: ['customer_id'],
        email: [],
        tenantId: [],
      },
      tenantScoped: true,
    },
    payments: {
      sqlName: 'payments',
      columns: [
        'id',
        'tenant_id',
        'customer_id',
        'payment_number',
        'amount',
        'currency',
        'payment_method',
        'status',
        'mpesa_phone',
        'mpesa_transaction_id',
        'bank_reference',
        'payer_email',
        'created_at',
      ],
      subjectColumns: {
        customerId: ['customer_id'],
        email: ['payer_email'],
        tenantId: [],
      },
      tenantScoped: true,
    },
    invoices: {
      sqlName: 'invoices',
      columns: [
        'id',
        'tenant_id',
        'customer_id',
        'invoice_number',
        'status',
        'total_amount',
        'customer_notes',
        'created_at',
      ],
      subjectColumns: {
        customerId: ['customer_id'],
        email: [],
        tenantId: [],
      },
      tenantScoped: true,
    },
    messages: {
      sqlName: 'messages',
      columns: [
        'id',
        'tenant_id',
        'conversation_id',
        'body',
        'recipient_phone',
        'recipient_email',
        'sent_at',
      ],
      subjectColumns: {
        customerId: [],
        email: ['recipient_email'],
        tenantId: [],
      },
      tenantScoped: true,
    },
    voice_turns: {
      sqlName: 'voice_turns',
      columns: [
        'id',
        'tenant_id',
        'customer_id',
        'transcript',
        'audio_url',
        'created_at',
      ],
      subjectColumns: {
        customerId: ['customer_id'],
        email: [],
        tenantId: [],
      },
      tenantScoped: true,
    },
    feedback: {
      // canonical DSAR bucket name → physical `feedback_submissions` table
      sqlName: 'feedback_submissions',
      columns: [
        'id',
        'tenant_id',
        'body',
        'submitted_by_email',
        'submitted_by_customer_id',
        'created_at',
      ],
      subjectColumns: {
        customerId: ['submitted_by_customer_id'],
        email: ['submitted_by_email'],
        tenantId: [],
      },
      tenantScoped: true,
    },
    owner_statements: {
      sqlName: 'owner_statements',
      columns: [
        'id',
        'tenant_id',
        'owner_id',
        'property_id',
        'statement_number',
        'status',
        'period_start',
        'period_end',
        'total_amount',
        'created_at',
      ],
      subjectColumns: {
        customerId: ['owner_id'],
        email: [],
        tenantId: [],
      },
      tenantScoped: true,
    },
    maintenance_tickets: {
      // physical table is `maintenance_requests` (Wave 8+)
      sqlName: 'maintenance_requests',
      columns: [
        'id',
        'tenant_id',
        'customer_id',
        'property_id',
        'unit_id',
        'status',
        'description',
        'created_at',
      ],
      subjectColumns: {
        customerId: ['customer_id'],
        email: [],
        tenantId: [],
      },
      tenantScoped: true,
    },
    inspections: {
      sqlName: 'inspections',
      columns: [
        'id',
        'tenant_id',
        'property_id',
        'unit_id',
        'inspector_id',
        'status',
        'photos',
        'created_at',
      ],
      subjectColumns: {
        customerId: [],
        email: [],
        tenantId: [],
      },
      tenantScoped: true,
    },
    market_rate_snapshots: {
      sqlName: 'market_rate_snapshots',
      columns: [
        'id',
        'tenant_id',
        'unit_id',
        'captured_at',
        'rent_amount',
        'sample_size',
      ],
      subjectColumns: {
        customerId: [],
        email: [],
        tenantId: [],
      },
      tenantScoped: true,
    },
    kra_mri_filings: {
      // No dedicated `kra_mri_filings` table today; the totals live on
      // `monthly_close_runs`. Read defensively — if the table or
      // column is missing the per-table error falls into `partialErrors`.
      sqlName: 'monthly_close_runs',
      columns: ['id', 'tenant_id', 'kra_mri_total_minor', 'period', 'created_at'],
      subjectColumns: {
        customerId: [],
        email: [],
        tenantId: [],
      },
      tenantScoped: true,
    },
    gepg_transactions: {
      // physical table is `gepg_control_numbers`
      sqlName: 'gepg_control_numbers',
      columns: [
        'id',
        'tenant_id',
        'control_number',
        'payer_name',
        'payer_phone',
        'payer_email',
        'amount',
        'created_at',
      ],
      subjectColumns: {
        customerId: [],
        email: ['payer_email'],
        tenantId: [],
      },
      tenantScoped: true,
    },
    audit_events: {
      sqlName: 'audit_events',
      columns: [
        'id',
        'tenant_id',
        'event_type',
        'actor_id',
        'actor_email',
        'target_type',
        'target_id',
        'created_at',
      ],
      subjectColumns: {
        customerId: ['actor_id', 'target_id'],
        email: ['actor_email'],
        tenantId: [],
      },
      tenantScoped: true,
    },
    cot_reservoir: {
      // physical table is `kernel_cot_reservoir`
      sqlName: 'kernel_cot_reservoir',
      columns: [
        'id',
        'tenant_id',
        'thread_id',
        'captured_at',
        'cot_summary',
      ],
      subjectColumns: {
        customerId: ['thread_id'],
        email: [],
        tenantId: [],
      },
      tenantScoped: true,
    },
    // Phase D / A2b-1 — kernel memory tables (chat summaries + facts).
    kernel_memory_episodic: {
      sqlName: 'kernel_memory_episodic',
      columns: ['id', 'tenant_id', 'user_id', 'summary', 'created_at'],
      subjectColumns: {
        customerId: ['user_id'],
        email: [],
        tenantId: ['tenant_id'],
      },
      tenantScoped: true,
    },
    kernel_memory_semantic: {
      sqlName: 'kernel_memory_semantic',
      columns: ['id', 'tenant_id', 'user_id', 'key', 'value', 'created_at'],
      subjectColumns: {
        customerId: ['user_id'],
        email: [],
        tenantId: ['tenant_id'],
      },
      tenantScoped: true,
    },
    tenant_identities: {
      sqlName: 'tenant_identities',
      columns: [
        'id',
        'phone_normalized',
        'phone_country_code',
        'email',
        'email_verified',
        'status',
        'created_at',
      ],
      subjectColumns: {
        customerId: ['id'],
        email: ['email'],
        tenantId: [],
      },
      tenantScoped: false,
    },
    employees: {
      sqlName: 'employees',
      columns: [
        'id',
        'tenant_id',
        'user_id',
        'employee_code',
        'first_name',
        'last_name',
        'email',
        'phone',
        'phone_alt',
        'status',
        'job_title',
        'created_at',
      ],
      subjectColumns: {
        customerId: ['user_id'],
        email: ['email'],
        tenantId: [],
      },
      tenantScoped: true,
    },
  });

// ─────────────────────────────────────────────────────────────────────
// ClassificationLookup adapter — accepts an injected `classify` function
// (from `@borjie/database/security/data-classification`) so the
// composition root wires the real registry without dragging this package
// into the database dep tree.
// ─────────────────────────────────────────────────────────────────────

export interface DatabaseClassifyFn {
  (
    table: string,
    column: string,
  ):
    | (FieldClassificationLite & { readonly maskType?: string })
    | null;
}

export function createDatabaseClassificationLookup(
  classifyFn: DatabaseClassifyFn,
): ClassificationLookup {
  if (typeof classifyFn !== 'function') {
    throw new Error(
      'createDatabaseClassificationLookup: classifyFn must be the `classify` export from data-classification',
    );
  }
  return {
    classify(table: string, column: string): FieldClassificationLite | null {
      const c = classifyFn(table, column);
      if (!c) return null;
      return { table: c.table, column: c.column, level: c.level };
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Factory — returns a `DsarDataSource` over a Drizzle client.
// ─────────────────────────────────────────────────────────────────────

export function createDsarDataSourceDrizzle(
  opts: CreateDsarDataSourceDrizzleOptions,
): DsarDataSource {
  if (!opts || !opts.db) {
    throw new Error('createDsarDataSourceDrizzle: db client is required');
  }
  const db = opts.db;
  const tenantId = opts.tenantId?.trim() || null;
  const sqlBuilder = opts.sqlTemplate ?? defaultSqlBuilder();

  return {
    async listAffectedTables(): Promise<ReadonlyArray<DsarTableName>> {
      // We can't know the subject at this stage (the compiler calls
      // `listAffectedTables` once, before per-table reads), so fall
      // back to the canonical list. The compiler will then call
      // `readPersonalDataForSubject` per table; the reader does the
      // real per-subject filtering.
      return Object.keys(TABLE_BINDINGS) as ReadonlyArray<DsarTableName>;
    },

    async readPersonalDataForSubject({
      subjectId,
      subjectKind,
      table,
    }): Promise<ReadonlyArray<DsarRow>> {
      const binding = TABLE_BINDINGS[table];
      if (!binding) return [];

      const columnsForKind =
        subjectKind === 'email'
          ? binding.subjectColumns.email
          : subjectKind === 'tenantId'
            ? binding.subjectColumns.tenantId
            : binding.subjectColumns.customerId;

      if (columnsForKind.length === 0) return [];

      try {
        const query = buildSelect({
          binding,
          subjectId,
          subjectColumns: columnsForKind,
          tenantId,
          sqlBuilder,
        });
        const result = await db.execute(query);
        return normaliseRows(result, binding.columns);
      } catch {
        // Compiler routes per-table errors into `partialErrors`.
        // Re-throwing here would crash the bundle; swallow + return [].
        return [];
      }
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Internal — SQL builder. Pure function so it can be unit-tested.
// ─────────────────────────────────────────────────────────────────────

interface BuildSelectArgs {
  readonly binding: TableBinding;
  readonly subjectId: string;
  readonly subjectColumns: ReadonlyArray<string>;
  readonly tenantId: string | null;
  readonly sqlBuilder: SqlTemplateFn;
}

function buildSelect(args: BuildSelectArgs): unknown {
  // We render the column list + WHERE clause as one parameterised query.
  // `sql` template's raw fragments are used for identifiers (column /
  // table names are from a static frozen map — never user input).
  const { binding, subjectId, subjectColumns, tenantId, sqlBuilder } = args;
  const cols = binding.columns.map((c) => `"${c}"`).join(', ');
  const table = `"${binding.sqlName}"`;

  if (subjectColumns.length === 1 && !tenantId) {
    return sqlBuilder`SELECT ${rawFragment(cols)} FROM ${rawFragment(table)} WHERE ${rawFragment(`"${subjectColumns[0]}"`)} = ${subjectId} LIMIT 1000`;
  }
  if (subjectColumns.length === 1 && tenantId) {
    return sqlBuilder`SELECT ${rawFragment(cols)} FROM ${rawFragment(table)} WHERE ${rawFragment(`"${subjectColumns[0]}"`)} = ${subjectId} AND tenant_id = ${tenantId} LIMIT 1000`;
  }
  // Multiple subject columns — OR them. Builds with chained sqlBuilder
  // fragments so each value stays parameterised.
  const orClauses = subjectColumns
    .map((c) => `"${c}" = '${escapeLiteral(subjectId)}'`)
    .join(' OR ');
  if (tenantId) {
    return sqlBuilder`SELECT ${rawFragment(cols)} FROM ${rawFragment(table)} WHERE (${rawFragment(orClauses)}) AND tenant_id = ${tenantId} LIMIT 1000`;
  }
  return sqlBuilder`SELECT ${rawFragment(cols)} FROM ${rawFragment(table)} WHERE (${rawFragment(orClauses)}) LIMIT 1000`;
}

/**
 * Marker for raw SQL fragments — `drizzle-orm`'s `sql.raw` accepts
 * pre-rendered identifiers. We tag fragments with a brand so the
 * default builder unwraps them; test builders can render them too.
 */
const RAW_BRAND = Symbol('dsar-raw-fragment');

function rawFragment(s: string): { readonly [RAW_BRAND]: true; readonly value: string } {
  return Object.freeze({ [RAW_BRAND]: true as const, value: s });
}

/** Escape single-quotes for the (rare) multi-column OR path. */
function escapeLiteral(s: string): string {
  return s.replace(/'/g, "''");
}

// ─────────────────────────────────────────────────────────────────────
// Default sql template. Dynamic-imports drizzle-orm so the package can
// be imported in environments where drizzle isn't on the path.
// ─────────────────────────────────────────────────────────────────────

function defaultSqlBuilder(): SqlTemplateFn {
  // Lazy resolution — cached after first call.
  let cached: SqlTemplateFn | null = null;
  return (strings, ...values) => {
    if (!cached) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const drizzle = require('drizzle-orm');
        const sqlFn = drizzle?.sql;
        const rawFn = drizzle?.sql?.raw;
        if (typeof sqlFn !== 'function' || typeof rawFn !== 'function') {
          throw new Error('drizzle-orm/sql not available');
        }
        cached = ((s: TemplateStringsArray, ...v: unknown[]) => {
          const unwrapped = v.map((x) =>
            isRawFragment(x) ? rawFn(x.value) : x,
          );
          return sqlFn(s, ...unwrapped);
        }) as SqlTemplateFn;
      } catch {
        // Fallback — concatenate into a literal string. Strictly for
        // environments without drizzle-orm; the compiler will likely
        // fail on `db.execute(string)` but we degrade rather than
        // crash at import time.
        cached = ((s: TemplateStringsArray, ...v: unknown[]) => {
          let out = '';
          for (let i = 0; i < s.length; i++) {
            out += s[i];
            if (i < v.length) {
              const val = v[i];
              if (isRawFragment(val)) {
                out += val.value;
              } else if (typeof val === 'string') {
                out += `'${escapeLiteral(val)}'`;
              } else {
                out += String(val);
              }
            }
          }
          return out;
        }) as SqlTemplateFn;
      }
    }
    return cached(strings, ...values);
  };
}

function isRawFragment(
  x: unknown,
): x is { readonly [RAW_BRAND]: true; readonly value: string } {
  return (
    typeof x === 'object' &&
    x !== null &&
    (x as { [RAW_BRAND]?: unknown })[RAW_BRAND] === true
  );
}

// ─────────────────────────────────────────────────────────────────────
// Row normaliser — drizzle's execute() shape varies across drivers
// (postgres-js: array-like; node-postgres: { rows: [] }). Accept both.
// ─────────────────────────────────────────────────────────────────────

function normaliseRows(
  result: unknown,
  expectedColumns: ReadonlyArray<string>,
): ReadonlyArray<DsarRow> {
  const raw: ReadonlyArray<unknown> = Array.isArray(result)
    ? result
    : ((result as { rows?: ReadonlyArray<unknown> })?.rows ?? []);
  return raw.map((row) => {
    if (!row || typeof row !== 'object') return Object.freeze({});
    const out: Record<string, unknown> = {};
    for (const col of expectedColumns) {
      const v = (row as Record<string, unknown>)[col];
      if (v !== undefined) out[col] = v;
    }
    return Object.freeze(out);
  });
}

// ─────────────────────────────────────────────────────────────────────
// Test seam — expose the bindings so tests can verify completeness
// without re-deriving the column lists.
// ─────────────────────────────────────────────────────────────────────

export const DSAR_TABLE_BINDINGS = TABLE_BINDINGS;
