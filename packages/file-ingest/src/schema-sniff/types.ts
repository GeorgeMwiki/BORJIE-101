/**
 * Schema-sniff output types.
 *
 * `InferredSchema` is the canonical handoff from schema-sniff to the
 * entity-mapping proposal layer. Every downstream consumer should treat
 * this object as immutable.
 */

/**
 * Loose value-type taxonomy. Deliberately small; downstream layers can
 * refine (e.g. "decimal_currency", "iso_date") via the LLM proposal step.
 */
export type InferredType =
  | 'string'
  | 'integer'
  | 'decimal'
  | 'boolean'
  | 'date'
  | 'datetime'
  | 'email'
  | 'phone'
  | 'currency'
  | 'unknown';

export interface InferredColumn {
  /** Column name as it appeared in the source file. */
  readonly name: string;
  /** Best-guess type. */
  readonly type: InferredType;
  /** 0..1 confidence in the inferred type. */
  readonly type_confidence: number;
  /** Up to 8 representative samples (non-null, deduped). */
  readonly samples: ReadonlyArray<string>;
  /** Fraction of rows whose value is null/empty (0..1). */
  readonly nullability: number;
  /** True if every non-null value is unique within the table. */
  readonly primary_key_candidate: boolean;
}

export interface InferredSchema {
  /** Total number of data rows (excludes the header row, if any). */
  readonly rowCount: number;
  /** Inferred columns, in source order. */
  readonly columns: ReadonlyArray<InferredColumn>;
  /**
   * Column names that look like good dedup keys (highly unique + low
   * nullability). The proposal layer combines these into a deterministic
   * entity_id.
   */
  readonly dedup_key_candidates: ReadonlyArray<string>;
  /**
   * Source format. Used for telemetry + downstream branching (e.g. PDF/OCR
   * outputs trigger different LLM prompts than CSV).
   */
  readonly source_format: 'csv' | 'excel' | 'pdf' | 'image_ocr';
  /** Schema version — bump when the InferredSchema shape changes. */
  readonly schema_version: string;
}

/**
 * Internal representation of a tabular dataset shared by all source
 * adapters. Not exported as part of the public API.
 *
 * `ingest_warnings` carries non-fatal advisories raised during parsing
 * (e.g. papaparse `result.errors`, redaction notes from the PDF
 * adapter). Adapters that produce no warnings still emit an empty array
 * for callers' uniform-shape convenience.
 */
export interface ParsedTable {
  readonly headers: ReadonlyArray<string>;
  readonly rows: ReadonlyArray<ReadonlyArray<string>>;
  readonly source_format: InferredSchema['source_format'];
  readonly ingest_warnings: ReadonlyArray<string>;
}
