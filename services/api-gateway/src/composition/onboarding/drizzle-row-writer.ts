/**
 * Drizzle-backed onboarding persistence ports.
 *
 * `@borjie/data-onboarding` is I/O-free — it expresses Stage-5
 * persistence through two ports (`RowWriter`, `ProvenanceWriter`) and
 * never touches a connection. This module is the production binding of
 * those ports onto the EXISTING Borjie domain tables. No new tables, no
 * schema-barrel edits.
 *
 * Hard rules honoured here:
 *
 *   - TENANT-SCOPED + RLS GUC-BOUND. Every write runs inside a single
 *     transaction whose FIRST statement binds `app.current_tenant_id`
 *     TRANSACTION-LOCALLY (`set_config(…, true)`) so RLS fires even on a
 *     pooled connection that the request middleware never touched. The
 *     same `tenant_id` is also written into every row and every WHERE.
 *
 *   - IDEMPOTENT on a natural key. Re-ingesting the same roster /
 *     licence is a no-op: the writer SELECTs by the entity's natural key
 *     (NIDA for workers, (kind, number) for licences, (licence_id,
 *     name) for sites) before inserting and reports `skip` when the row
 *     already exists. None of these natural keys is a DB UNIQUE
 *     constraint, so idempotency is enforced in application code under
 *     the row lock the surrounding transaction provides.
 *
 *   - AUDITED, append-only, hash-chained. Every upsert appends one row
 *     to `ai_audit_chain` (migration 0127) linked to the tenant's prior
 *     entry via `prev_hash → this_hash`. The hash is computed with the
 *     same HMAC primitive (`@borjie/audit-hash-chain`) the AI audit
 *     verifier already walks.
 *
 *   - NO money writes. This path only ever touches `employees`,
 *     `sites`, `licences`, `ocr_extractions`, `ai_audit_chain`,
 *     `data_onboarding_sessions`, `data_onboarding_row_provenance`.
 *
 * The package speaks in LOGICAL recipe table names (`workers`,
 * `mining_licences`, `ore_parcels`, …). The physical Borjie schema uses
 * `employees` / `licences`. The `TABLE_BINDINGS` map below is the single
 * place that translation lives — the I/O boundary owns physical-schema
 * knowledge so the package stays pure.
 */

import { randomUUID, createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { hashChainEntry } from '@borjie/audit-hash-chain';
import type {
  RowWriter,
  ProvenanceWriter,
  ProvenanceEntry,
} from '@borjie/data-onboarding';

/**
 * Minimal slice of the tenant-scoped, transaction-bound Drizzle client
 * the writers need. The real type is `DatabaseClient` (or its tx
 * flavour); we accept the structural `execute` surface so tests can
 * inject a fake without dragging the full Drizzle types in.
 */
export interface OnboardingTxClient {
  execute(query: unknown): Promise<unknown>;
}

export interface OnboardingWriterCtx {
  /** Transaction-bound client (GUC already set by the caller). */
  readonly tx: OnboardingTxClient;
  readonly tenantId: string;
  /** Acting user — stamped into the audit payload (non-repudiation). */
  readonly userId: string;
  /** Onboarding session id — links provenance + audit back to the run. */
  readonly sessionId: string;
  /**
   * Default company id for `employees.company_id` (NOT NULL FK). The
   * route resolves the tenant's company before opening the writer.
   */
  readonly defaultCompanyId: string | null;
  /**
   * Default licence id for `sites.licence_id` (NOT NULL FK). Optional —
   * a site row without a resolvable licence is skipped rather than
   * violating the FK.
   */
  readonly defaultLicenceId: string | null;
  /**
   * Default site id for `drill_holes.site_id` (NOT NULL FK). Optional — a
   * drill-hole row without a resolvable site is skipped rather than
   * violating the FK. Absent on the worker / site / licence paths.
   */
  readonly defaultSiteId?: string | null;
}

// ---------------------------------------------------------------------------
// Physical-table bindings (logical recipe name → real Borjie table)
// ---------------------------------------------------------------------------

interface NaturalKey {
  /** Logical source field on the projected row that holds the key. */
  readonly source_field: string;
  /** Physical column the key maps to. */
  readonly column: string;
}

interface TableBinding {
  /** Physical table name in Postgres. */
  readonly physical: string;
  /** Natural key used for idempotency (re-ingest = no-op). */
  readonly natural_key: NaturalKey;
  /**
   * Project a recipe row (keyed by logical target_field) into the
   * physical INSERT column→value map. Returns `null` when a required
   * column cannot be resolved — the row is then SKIPPED (never a
   * partial / FK-violating insert).
   */
  readonly project: (
    values: Readonly<Record<string, unknown>>,
    ctx: OnboardingWriterCtx,
    id: string,
  ) => Readonly<Record<string, unknown>> | null;
}

function asText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return null;
}

/** First non-null logical field from a candidate list. */
function pick(
  values: Readonly<Record<string, unknown>>,
  ...fields: ReadonlyArray<string>
): string | null {
  for (const field of fields) {
    const resolved = asText(values[field]);
    if (resolved !== null) return resolved;
  }
  return null;
}

const TABLE_BINDINGS: Readonly<Record<string, TableBinding>> = Object.freeze({
  // ── workers → employees ────────────────────────────────────────────
  workers: Object.freeze({
    physical: 'employees',
    natural_key: Object.freeze({ source_field: 'nida', column: 'nida_id' }),
    project: (values, ctx, id) => {
      const fullName = pick(values, 'name', 'full_name', 'fullName');
      const companyId = ctx.defaultCompanyId;
      // employees.full_name + company_id are NOT NULL — skip rather than
      // violate the constraint.
      if (fullName === null || companyId === null) return null;
      const nida = pick(values, 'nida', 'nida_id', 'national_id');
      const role = pick(values, 'role', 'designation') ?? 'worker';
      return Object.freeze({
        id,
        tenant_id: ctx.tenantId,
        company_id: companyId,
        full_name: fullName,
        nida_id: nida,
        role,
      });
    },
  }),
  // ── sites → sites ──────────────────────────────────────────────────
  sites: Object.freeze({
    physical: 'sites',
    natural_key: Object.freeze({ source_field: 'name', column: 'name' }),
    project: (values, ctx, id) => {
      const name = pick(values, 'name', 'site_name', 'site_id');
      const licenceId = ctx.defaultLicenceId;
      // sites.licence_id + mineral are NOT NULL.
      if (name === null || licenceId === null) return null;
      const mineral = pick(values, 'mineral', 'primary_mineral') ?? 'unknown';
      const phase = pick(values, 'phase') ?? 'pre_licence';
      return Object.freeze({
        id,
        tenant_id: ctx.tenantId,
        licence_id: licenceId,
        name,
        mineral,
        phase,
      });
    },
  }),
  // ── mining_licences → licences ─────────────────────────────────────
  mining_licences: Object.freeze({
    physical: 'licences',
    natural_key: Object.freeze({ source_field: 'licence_no', column: 'number' }),
    project: (values, ctx, id) => {
      const number = pick(values, 'licence_no', 'license_no', 'permit_no', 'number');
      const companyId = ctx.defaultCompanyId;
      // licences.company_id + number + mineral are NOT NULL.
      if (number === null || companyId === null) return null;
      const mineral = pick(values, 'mineral') ?? 'unknown';
      const kind = pick(values, 'kind', 'licence_kind', 'type') ?? 'PML';
      return Object.freeze({
        id,
        tenant_id: ctx.tenantId,
        company_id: companyId,
        kind,
        number,
        mineral,
      });
    },
  }),
  // ── drill_holes → drill_holes ──────────────────────────────────────
  drill_holes: Object.freeze({
    physical: 'drill_holes',
    natural_key: Object.freeze({
      source_field: 'hole_id',
      column: 'hole_id_external',
    }),
    project: (values, ctx, id) => {
      const holeId = pick(values, 'hole_id', 'hole_id_external', 'hole', 'name');
      const siteId = ctx.defaultSiteId ?? null;
      // drill_holes.site_id + hole_id_external + kind are NOT NULL — skip
      // rather than violate the constraint / FK.
      if (holeId === null || siteId === null) return null;
      const kind = pick(values, 'kind', 'hole_kind', 'type') ?? 'exploration';
      return Object.freeze({
        id,
        tenant_id: ctx.tenantId,
        site_id: siteId,
        hole_id_external: holeId,
        kind,
      });
    },
  }),
});

export function isSupportedOnboardingTable(logical: string): boolean {
  return Object.prototype.hasOwnProperty.call(TABLE_BINDINGS, logical);
}

export const SUPPORTED_ONBOARDING_TABLES: ReadonlyArray<string> = Object.freeze(
  Object.keys(TABLE_BINDINGS),
);

// ---------------------------------------------------------------------------
// SQL helpers — JSONB row reader
// ---------------------------------------------------------------------------

function rowsOf(result: unknown): ReadonlyArray<Record<string, unknown>> {
  if (Array.isArray(result)) {
    return result as ReadonlyArray<Record<string, unknown>>;
  }
  const rows = (result as { rows?: unknown }).rows;
  if (Array.isArray(rows)) {
    return rows as ReadonlyArray<Record<string, unknown>>;
  }
  return [];
}

/** Build an `INSERT … (cols) VALUES (vals)` statement from a value map. */
function buildInsert(
  physical: string,
  values: Readonly<Record<string, unknown>>,
): ReturnType<typeof sql> {
  const columns = Object.keys(values);
  const identifiers = columns.map((c) => sql.identifier(c));
  const params = columns.map((c) => sql`${values[c]}`);
  return sql`
    INSERT INTO ${sql.identifier(physical)} (${sql.join(identifiers, sql`, `)})
    VALUES (${sql.join(params, sql`, `)})
    RETURNING id
  `;
}

// ---------------------------------------------------------------------------
// Audit appender — hash-chained ai_audit_chain row per write
// ---------------------------------------------------------------------------

const ONBOARDING_AUDIT_SECRET_ID = 'data_onboarding_row_persist_v1';

/**
 * The minimal slice of {@link OnboardingWriterCtx} the audit appender reads.
 * Declaring it separately lets the company-materialisation path
 * ({@link ensureCompanyForTenant}) reuse the same hash-chained appender
 * without first resolving the company / licence FKs.
 */
interface AuditCtx {
  readonly tx: OnboardingTxClient;
  readonly tenantId: string;
  readonly userId: string;
  readonly sessionId: string;
}

interface AuditAppendArgs {
  readonly ctx: AuditCtx;
  readonly physical: string;
  readonly rowId: string;
  readonly operation: 'insert' | 'update' | 'skip';
  readonly naturalKeyValue: string | null;
}

/**
 * Append one hash-chained entry to `ai_audit_chain`. Reads the tenant's
 * latest `sequence_id` + `this_hash` inside the same transaction, so a
 * concurrent run on another connection cannot interleave a gap (the row
 * lock from `FOR UPDATE` on the max-sequence row serialises appends per
 * tenant). Returns the freshly computed `this_hash`.
 */
async function appendAudit(args: AuditAppendArgs): Promise<string> {
  const { ctx } = args;
  const latest = rowsOf(
    await ctx.tx.execute(
      sql`
        SELECT sequence_id, this_hash
        FROM ai_audit_chain
        WHERE tenant_id = ${ctx.tenantId}
        ORDER BY sequence_id DESC
        LIMIT 1
        FOR UPDATE
      `,
    ),
  );

  const prevHash =
    latest.length > 0 ? String(latest[0]!.this_hash ?? 'GENESIS') : 'GENESIS';
  const prevSeq =
    latest.length > 0
      ? Number(latest[0]!.sequence_id ?? 0)
      : 0;
  const sequenceId = prevSeq + 1;
  const turnId = randomUUID();
  const action = `data_onboarding.persist.${args.operation}`;
  const payload = {
    table: args.physical,
    row_id: args.rowId,
    operation: args.operation,
    natural_key: args.naturalKeyValue,
    session_id: ctx.sessionId,
    actor_id: ctx.userId,
  } as const;

  const thisHash = hashChainEntry({
    prev: prevHash,
    payload,
    secretId: ONBOARDING_AUDIT_SECRET_ID,
  });

  await ctx.tx.execute(
    sql`
      INSERT INTO ai_audit_chain (
        id, tenant_id, sequence_id, turn_id, session_id, action,
        prev_hash, this_hash, payload_ref, payload, created_at
      ) VALUES (
        ${randomUUID()},
        ${ctx.tenantId},
        ${sequenceId},
        ${turnId},
        ${ctx.sessionId},
        ${action},
        ${prevHash},
        ${thisHash},
        ${args.rowId},
        ${JSON.stringify(payload)}::jsonb,
        ${new Date().toISOString()}
      )
    `,
  );

  return thisHash;
}

// ---------------------------------------------------------------------------
// Company materialisation — KYB → companies row (FK prerequisite)
// ---------------------------------------------------------------------------

/**
 * Captured KYB facts for one tenant company. The `/onboarding` wizard
 * records these in `mining_onboarding_runs.steps.kyb.payload`; the commit
 * path reads them and hands them here so a brand-new tenant's first licence
 * /worker commit has a real `companies` row to FK against (instead of the
 * licence projection silently SKIPping for want of a `company_id`).
 */
export interface CompanyKyb {
  readonly companyName: string;
  readonly registrationNo: string;
  readonly tin?: string | null;
  readonly registeredAddress?: string | null;
}

export interface EnsureCompanyResult {
  readonly companyId: string;
  readonly operation: 'insert' | 'skip';
  readonly auditHash: string;
}

/**
 * Idempotently materialise the tenant's company row from captured KYB,
 * INSIDE the caller's tenant-GUC-bound transaction.
 *
 * Natural key: `(tenant_id, registration_no)` — the existing UNIQUE index
 * `companies_reg_no_idx` (baseline migration `drizzle/0003_mining_domain.sql`).
 * `ON CONFLICT … DO NOTHING` makes re-commit a no-op: a second commit for
 * the same tenant + registration number never creates a duplicate company.
 * RLS FORCE on `companies` (baseline 0003) plus the explicit `tenant_id`
 * column keep this tenant-isolated; the row is appended to the hash-chained
 * `ai_audit_chain` exactly like every other onboarding insert.
 *
 * Returns the resolved `companyId` (whether freshly inserted or pre-existing)
 * so the caller can resolve it as the default company for the recipe writer.
 */
export async function ensureCompanyForTenant(args: {
  readonly ctx: AuditCtx;
  readonly kyb: CompanyKyb;
}): Promise<EnsureCompanyResult> {
  const { ctx, kyb } = args;
  const name = asText(kyb.companyName);
  const registrationNo = asText(kyb.registrationNo);
  if (name === null || registrationNo === null) {
    throw new Error(
      'ensureCompanyForTenant: companyName + registrationNo are required',
    );
  }
  const tin = asText(kyb.tin ?? null);
  const registeredAddress = asText(kyb.registeredAddress ?? null);
  const id = randomUUID();

  // UPSERT on the natural key — DO NOTHING so a re-commit never duplicates.
  // RETURNING id only fires on a fresh insert; an existing row is read back
  // by the SELECT fallback below (idempotency path).
  const inserted = rowsOf(
    await ctx.tx.execute(
      sql`
        INSERT INTO companies (
          id, tenant_id, name, registration_no, tin, registered_address
        ) VALUES (
          ${id},
          ${ctx.tenantId},
          ${name},
          ${registrationNo},
          ${tin},
          ${registeredAddress}
        )
        ON CONFLICT (tenant_id, registration_no) DO NOTHING
        RETURNING id
      `,
    ),
  );

  if (inserted.length > 0) {
    const companyId = String(inserted[0]!.id);
    const auditHash = await appendAudit({
      ctx,
      physical: 'companies',
      rowId: companyId,
      operation: 'insert',
      naturalKeyValue: registrationNo,
    });
    return Object.freeze({ companyId, operation: 'insert' as const, auditHash });
  }

  // Conflict → the company already exists for this (tenant, registration_no).
  const existing = rowsOf(
    await ctx.tx.execute(
      sql`
        SELECT id FROM companies
        WHERE tenant_id = ${ctx.tenantId}
          AND registration_no = ${registrationNo}
        LIMIT 1
      `,
    ),
  );
  if (existing.length === 0) {
    // Should be unreachable (conflict implies a row), but never fabricate.
    throw new Error('ensureCompanyForTenant: conflict without resolvable row');
  }
  const companyId = String(existing[0]!.id);
  const auditHash = await appendAudit({
    ctx,
    physical: 'companies',
    rowId: companyId,
    operation: 'skip',
    naturalKeyValue: registrationNo,
  });
  return Object.freeze({ companyId, operation: 'skip' as const, auditHash });
}

// ---------------------------------------------------------------------------
// RowWriter — Drizzle implementation
// ---------------------------------------------------------------------------

/**
 * Build the tenant-scoped, transaction-bound `RowWriter`. The caller is
 * responsible for opening the transaction and binding the tenant GUC
 * before constructing this; every `upsertRow` runs on `ctx.tx`.
 */
export function createDrizzleRowWriter(ctx: OnboardingWriterCtx): RowWriter {
  return Object.freeze({
    async upsertRow(input: {
      readonly table: string;
      readonly primary_key_field: string;
      readonly values: Readonly<Record<string, unknown>>;
    }): Promise<{ row_id: string; operation: 'insert' | 'update' | 'skip' }> {
      const binding = TABLE_BINDINGS[input.table];
      if (binding === undefined) {
        throw new Error(
          `onboarding RowWriter: unsupported target table "${input.table}" ` +
            `(supported: ${SUPPORTED_ONBOARDING_TABLES.join(', ')})`,
        );
      }

      const naturalKeyValue = asText(
        input.values[binding.natural_key.source_field],
      );

      // ── Idempotency: SELECT by natural key (tenant-scoped) ──────────
      if (naturalKeyValue !== null) {
        const existing = rowsOf(
          await ctx.tx.execute(
            sql`
              SELECT id
              FROM ${sql.identifier(binding.physical)}
              WHERE tenant_id = ${ctx.tenantId}
                AND ${sql.identifier(binding.natural_key.column)} = ${naturalKeyValue}
              LIMIT 1
            `,
          ),
        );
        if (existing.length > 0) {
          const existingId = String(existing[0]!.id);
          await appendAudit({
            ctx,
            physical: binding.physical,
            rowId: existingId,
            operation: 'skip',
            naturalKeyValue,
          });
          return Object.freeze({ row_id: existingId, operation: 'skip' });
        }
      }

      // ── Insert ──────────────────────────────────────────────────────
      const id = randomUUID();
      const projected = binding.project(input.values, ctx, id);
      if (projected === null) {
        // Required column / FK unresolved — skip (never a partial insert).
        await appendAudit({
          ctx,
          physical: binding.physical,
          rowId: id,
          operation: 'skip',
          naturalKeyValue,
        });
        return Object.freeze({ row_id: id, operation: 'skip' });
      }

      const inserted = rowsOf(
        await ctx.tx.execute(buildInsert(binding.physical, projected)),
      );
      const rowId = inserted.length > 0 ? String(inserted[0]!.id) : id;

      await appendAudit({
        ctx,
        physical: binding.physical,
        rowId,
        operation: 'insert',
        naturalKeyValue,
      });

      return Object.freeze({ row_id: rowId, operation: 'insert' });
    },
  });
}

// ---------------------------------------------------------------------------
// ProvenanceWriter — Drizzle implementation
// ---------------------------------------------------------------------------

/**
 * Build the tenant-scoped, transaction-bound `ProvenanceWriter`. Writes
 * one `data_onboarding_row_provenance` row per persisted DB row, binding
 * (target_table, target_row_id) back to the source document + sheet +
 * row number. The `source_session_id` FK requires the onboarding
 * session row to exist first (the route inserts it before commit).
 */
export function createDrizzleProvenanceWriter(
  ctx: OnboardingWriterCtx,
): ProvenanceWriter {
  async function writeOne(entry: ProvenanceEntry): Promise<void> {
    await ctx.tx.execute(
      sql`
        INSERT INTO data_onboarding_row_provenance (
          id, tenant_id, target_table, target_row_id, source_session_id,
          source_file_name, source_sheet, source_row_number, operation,
          audit_hash, recorded_at
        ) VALUES (
          ${randomUUID()},
          ${ctx.tenantId},
          ${entry.target_table},
          ${entry.target_row_id},
          ${ctx.sessionId},
          ${entry.source_file_name},
          ${entry.source_sheet},
          ${entry.source_row_number},
          ${entry.operation},
          ${entry.audit_hash},
          ${new Date().toISOString()}
        )
      `,
    );
  }

  return Object.freeze({
    async write(entry: ProvenanceEntry): Promise<void> {
      await writeOne(entry);
    },
    async writeBatch(entries: ReadonlyArray<ProvenanceEntry>): Promise<void> {
      for (const entry of entries) {
        await writeOne(entry);
      }
    },
  });
}

// ---------------------------------------------------------------------------
// Convenience — build both ports at once
// ---------------------------------------------------------------------------

export interface OnboardingWriters {
  readonly writer: RowWriter;
  readonly provenance: ProvenanceWriter;
}

export function createDrizzleOnboardingWriters(
  ctx: OnboardingWriterCtx,
): OnboardingWriters {
  return Object.freeze({
    writer: createDrizzleRowWriter(ctx),
    provenance: createDrizzleProvenanceWriter(ctx),
  });
}

/** Digest a source-file id into a stable short ref (audit payload). */
export function digestSourceRef(ref: string): string {
  return createHash('sha256').update(ref).digest('hex').slice(0, 16);
}
