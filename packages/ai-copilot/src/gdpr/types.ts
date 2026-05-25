/**
 * Shared types for the DSAR (Data-Subject Access Request) compiler.
 *
 * Defined in a separate module so the data-source port can be implemented
 * in the composition root (api-gateway / domain-services) without dragging
 * the compiler into a cross-package cycle.
 */

/** Sensitivity tier — mirrors the database-package `ClassificationLevel`. */
export type ClassificationLevel =
  | 'RESTRICTED'
  | 'CONFIDENTIAL'
  | 'INTERNAL'
  | 'PUBLIC';

/**
 * Minimal classification shape the compiler needs from the registry.
 * The full record (encryptAtRest, maskType, retention) is intentionally
 * NOT required so this package never has to track those concerns.
 */
export interface FieldClassificationLite {
  readonly table: string;
  readonly column: string;
  readonly level: ClassificationLevel;
}

/**
 * Lookup port — wired in the composition root to
 * `packages/database/src/security/data-classification.ts::classify`.
 *
 * Returning `null` means the column is unregistered. The compiler
 * treats unregistered columns as un-annotated (no entry in the
 * classification map) — never throws.
 */
export interface ClassificationLookup {
  classify(table: string, column: string): FieldClassificationLite | null;
}

/** Bundle version. Bumps on wire-format break. */
export type DsarBundleSchemaVersion = '1.0.0';

/**
 * Tables included in a DSAR bundle. Tracks the property-management
 * surfaces: customers, leases, payments, invoices, communications
 * (messages), voice turns, feedback, owner statements, maintenance
 * tickets, inspections, market-rate snapshots, KRA MRI filings, GEPG
 * transactions, audit, and the kernel's CoT reservoir.
 */
export type DsarTableName =
  | 'customers'
  | 'leases'
  | 'payments'
  | 'invoices'
  | 'messages'
  | 'voice_turns'
  | 'feedback'
  | 'owner_statements'
  | 'maintenance_tickets'
  | 'inspections'
  | 'market_rate_snapshots'
  | 'kra_mri_filings'
  | 'gepg_transactions'
  | 'audit_events'
  | 'cot_reservoir'
  // Phase D / A2b-1 — kernel memory tables hold chat summaries and
  // user-declared facts; both must be HARD_DELETE on RTBF.
  | 'kernel_memory_episodic'
  | 'kernel_memory_semantic'
  // tenant_identities — cross-org principal; anonymize email + phone.
  | 'tenant_identities'
  // employees — staff PII; anonymize names + contact details.
  | 'employees';

/**
 * One row in a DSAR bundle. Plain JSON object — values are scalars,
 * dates rendered as ISO strings, foreign keys as strings.
 */
export type DsarRow = Readonly<Record<string, unknown>>;

/**
 * Data source port. The composition root wires this against Drizzle;
 * tests inject in-memory stubs.
 *
 * `readPersonalDataForSubject` MUST scope to the given subject — never
 * leak cross-subject rows. The compiler trusts the source on this.
 */
export interface DsarDataSource {
  /**
   * Read all rows in `table` belonging to `subjectId`. Returns `[]`
   * when no rows match. Implementations should swallow per-table
   * errors and rethrow only on programmer-error (eg. unknown table).
   */
  readPersonalDataForSubject(args: {
    readonly subjectId: string;
    readonly subjectKind: 'email' | 'tenantId' | 'customerId';
    readonly table: DsarTableName;
  }): Promise<ReadonlyArray<DsarRow>>;

  /**
   * Optional optimisation: list the tables that contain ANY row for
   * the subject. Lets the compiler skip empty tables. When the
   * impl can't compute this cheaply, return the full canonical list.
   */
  listAffectedTables(): Promise<ReadonlyArray<DsarTableName>>;
}

/**
 * Compile request. Per Art.20 the subject is either an email (for
 * customer-side requests) or a tenant id (for owner-side requests).
 */
export interface CompileDsarRequest {
  readonly subjectId: string;
  /** Optional explicit kind; otherwise inferred from the subjectId shape. */
  readonly subjectKind?: 'email' | 'tenantId' | 'customerId';
}

/**
 * Compile options. Every field is injectable so tests stay
 * deterministic and the composition root can swap impls without
 * editing the compiler.
 */
export interface CompileDsarOptions {
  readonly dataSource?: DsarDataSource;
  readonly classifications?: ClassificationLookup;
  /** Injectable clock for deterministic timestamps in tests. */
  readonly now?: () => Date;
}

/**
 * The output bundle. Wire-format: serialise via `JSON.stringify` —
 * every value is a plain JSON-serialisable scalar / object.
 */
export interface DsarBundle {
  readonly schemaVersion: DsarBundleSchemaVersion;
  readonly subjectId: string;
  readonly subjectKind: 'email' | 'tenantId' | 'customerId';
  /** ISO-8601 UTC timestamp; deterministic when `now` is injected. */
  readonly generatedAt: string;
  /** One bucket per table; empty arrays preserved for completeness. */
  readonly tables: Readonly<Record<string, ReadonlyArray<DsarRow>>>;
  /**
   * Map of `${table}.${column}` → sensitivity level. Columns absent
   * from the registry are absent here — auditors should treat the
   * absence as "INTERNAL by default".
   */
  readonly classifications: Readonly<Record<string, ClassificationLevel>>;
  /** Per-table failures collected from the data source (never throws). */
  readonly partialErrors: ReadonlyArray<{
    readonly table: DsarTableName;
    readonly message: string;
  }>;
  /** Row counts per table; useful for compliance dashboards. */
  readonly counts: Readonly<Record<string, number>>;
}
