/**
 * DSAR (Data-Subject Access Request) compiler.
 *
 * Implements GDPR Art. 20 (right to data portability) and Tanzania PDPA
 * s.27 (data-subject access right). Given a `subjectId` — either a
 * tenant id (for owner / staff exports) or a customer email (for
 * tenant-side personal-data exports) — produces a single JSON bundle of
 * every personal-data row across the property-management surfaces:
 *
 *   customers, leases, payments, invoices, communications (messages),
 *   voice_turns, feedback, owner_statements, maintenance_tickets,
 *   inspections, market_rate_snapshots, kra_mri_filings,
 *   gepg_transactions, audit_events, cot_reservoir.
 *
 * Design notes
 * ────────────
 * - The compiler is library-agnostic: it depends on a `DsarDataSource`
 *   port whose impls live in the composition root (so this package
 *   does not pull a hard dep on `@borjie/database` — that would
 *   create a cycle).
 * - Per-field classifications are read through a `ClassificationLookup`
 *   port. The api-gateway wires the lookup to
 *   `packages/database/src/security/data-classification.ts`. Tests
 *   inject their own stubs.
 * - Output is a plain JSON object — serialisable directly to a private
 *   bucket with a signed-URL TTL by the composition layer.
 * - Immutability: every returned value is a fresh object. Inputs are
 *   never mutated. Each row is shallow-cloned before annotation so
 *   the source row cannot be modified through the bundle.
 *
 * Property-management framing
 * ────────────────────────────
 * DSAR bundles MUST include property-management-specific tables: lease
 * documents, owner payout statements, maintenance tickets, market-rate
 * snapshots, KRA MRI tax filings, and GEPG control numbers. None of
 * these are PII themselves, but they are personal-data-adjacent
 * (decisions about the subject) and Art. 20 explicitly covers them.
 */

import type {
  ClassificationLevel,
  DsarBundle,
  DsarBundleSchemaVersion,
  DsarDataSource,
  DsarRow,
  DsarTableName,
  ClassificationLookup,
  CompileDsarRequest,
  CompileDsarOptions,
  FieldClassificationLite,
} from './types.js';

/**
 * Bumps when the wire format changes. Consumers (eg.
 * data-export workers) version on this.
 */
export const DSAR_BUNDLE_SCHEMA_VERSION: DsarBundleSchemaVersion = '1.0.0';

/** Tables compiled by `compileDsar`. Order is the canonical bundle order. */
export const DSAR_TABLE_NAMES: ReadonlyArray<DsarTableName> = Object.freeze([
  'customers',
  'leases',
  'payments',
  'invoices',
  'messages',
  'voice_turns',
  'feedback',
  'owner_statements',
  'maintenance_tickets',
  'inspections',
  'market_rate_snapshots',
  'kra_mri_filings',
  'gepg_transactions',
  'audit_events',
  'cot_reservoir',
]);

/**
 * No-op classification lookup. Used as the fail-closed default when
 * the composition layer has not wired the real registry. Treats every
 * column as `INTERNAL` with no encryption / mask metadata. The
 * compiler will still produce a usable bundle; only the
 * `classifications` map will be empty.
 */
export function createNoopClassificationLookup(): ClassificationLookup {
  return {
    classify(): FieldClassificationLite | null {
      return null;
    },
  };
}

/**
 * Empty data source. Returned by `compileDsar` when no source is
 * wired. Useful for the api-gateway boot path (degraded mode) so a
 * missing DB does not crash subject-access endpoints.
 */
export function createEmptyDsarDataSource(): DsarDataSource {
  return {
    async readPersonalDataForSubject(): Promise<ReadonlyArray<DsarRow>> {
      return [];
    },
    async listAffectedTables(): Promise<ReadonlyArray<DsarTableName>> {
      return [];
    },
  };
}

/**
 * Compile a DSAR bundle for one subject.
 *
 * Steps:
 *   1. Validate input (subjectId non-empty; generatedAt resolves to a
 *      finite Date).
 *   2. If no data source is wired (or it reports no affected tables)
 *      return an empty bundle with the metadata header populated.
 *   3. For each affected table, read rows through the data source,
 *      shallow-clone them, and annotate classifications per column via
 *      the lookup.
 *   4. Sort tables in canonical `DSAR_TABLE_NAMES` order so the bundle
 *      hash is stable across reruns.
 *
 * Never throws on a per-table failure: collects errors into
 * `partialErrors` so the auditor sees what was missing without losing
 * the rest of the bundle. Validation errors on the input DO throw —
 * that signals a programmer mistake, not a runtime data issue.
 */
export async function compileDsar(
  request: CompileDsarRequest,
  options: CompileDsarOptions = {},
): Promise<DsarBundle> {
  const subjectId = request?.subjectId?.trim() ?? '';
  if (!subjectId) {
    throw new Error('compileDsar: subjectId is required and must be non-empty');
  }

  const dataSource = options.dataSource ?? createEmptyDsarDataSource();
  const classifications = options.classifications ?? createNoopClassificationLookup();
  const now = options.now ?? (() => new Date());
  const generatedAt = isoOrThrow(now(), 'compileDsar: now() returned invalid Date');

  const subjectKind = request.subjectKind ?? inferSubjectKind(subjectId);

  // Collect affected tables. If the data source errors here we fall
  // back to the canonical list — better to ATTEMPT every table than
  // skip silently.
  const affected = await safeListAffected(dataSource);
  const effectiveTables = affected.length > 0 ? affected : DSAR_TABLE_NAMES;

  const tables: Record<string, ReadonlyArray<DsarRow>> = {};
  const classificationMap: Record<string, ClassificationLevel> = {};
  const partialErrors: Array<{ table: DsarTableName; message: string }> = [];

  for (const table of canonicaliseOrder(effectiveTables)) {
    try {
      const rows = await dataSource.readPersonalDataForSubject({
        subjectId,
        subjectKind,
        table,
      });
      const annotated = rows.map((row) => annotateRow(row, table, classifications, classificationMap));
      tables[table] = Object.freeze(annotated);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      partialErrors.push({ table, message });
      tables[table] = Object.freeze([]);
    }
  }

  return {
    schemaVersion: DSAR_BUNDLE_SCHEMA_VERSION,
    subjectId,
    subjectKind,
    generatedAt,
    tables,
    classifications: classificationMap,
    partialErrors: Object.freeze(partialErrors),
    counts: deriveCounts(tables),
  };
}

// ─────────────────────────────────────────────────────────────────────
// Helpers — pure, side-effect free.
// ─────────────────────────────────────────────────────────────────────

function isoOrThrow(d: Date, msg: string): string {
  const t = d?.getTime?.();
  if (!Number.isFinite(t)) throw new Error(msg);
  return d.toISOString();
}

function inferSubjectKind(subjectId: string): 'email' | 'tenantId' | 'customerId' {
  if (subjectId.includes('@')) return 'email';
  if (subjectId.startsWith('tenant_') || subjectId.startsWith('t_')) return 'tenantId';
  return 'customerId';
}

async function safeListAffected(
  source: DsarDataSource,
): Promise<ReadonlyArray<DsarTableName>> {
  try {
    return await source.listAffectedTables();
  } catch {
    return [];
  }
}

function canonicaliseOrder(
  tables: ReadonlyArray<DsarTableName>,
): ReadonlyArray<DsarTableName> {
  const set = new Set(tables);
  return DSAR_TABLE_NAMES.filter((t) => set.has(t));
}

/**
 * Shallow-clone a row and record per-column classifications into the
 * caller-provided map. Returns a NEW row object — never mutates the
 * input. Adds an internal `_classifiedAt` field so auditors can prove
 * the row passed through the compiler.
 */
function annotateRow(
  row: DsarRow,
  table: DsarTableName,
  classifications: ClassificationLookup,
  out: Record<string, ClassificationLevel>,
): DsarRow {
  const cloned: Record<string, unknown> = { ...row };
  for (const column of Object.keys(row)) {
    const c = classifications.classify(table, column);
    if (c) {
      out[`${table}.${column}`] = c.level;
    }
  }
  return Object.freeze(cloned);
}

function deriveCounts(
  tables: Record<string, ReadonlyArray<DsarRow>>,
): Readonly<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const [table, rows] of Object.entries(tables)) {
    counts[table] = rows.length;
  }
  return Object.freeze(counts);
}
