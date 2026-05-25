/**
 * tsvector update trigger SQL generator.
 *
 * Migration 0186 installs the canonical trigger directly. This module
 * exposes the same SQL via a parameterised generator for any future
 * table that wants the same `BM25-ish tsv` shape — and for unit tests
 * that need to assert the generated SQL is correctly weighted.
 */

export interface TsvTriggerColumnConfig {
  /** Column name in the target table. */
  readonly column: string;
  /** ts_rank weight: 'A' (highest) | 'B' | 'C' | 'D' (lowest). */
  readonly weight: 'A' | 'B' | 'C' | 'D';
  /**
   * Optional cast applied via `coalesce(<column>::text, '')`. Set to
   * `'jsonb'` for JSONB columns; defaults to no cast (handled as TEXT).
   */
  readonly cast?: 'jsonb' | null;
}

export interface TsvTriggerConfig {
  /** Public table name. */
  readonly table: string;
  /** Target column to populate (typically `tsv`). */
  readonly targetColumn: string;
  /** Trigger / function name prefix (e.g. `core_entity_tsv`). */
  readonly name: string;
  /**
   * Columns to fold into the tsvector with weights. The order in the
   * array determines fold order in the generated expression; the
   * `weight` field determines BM25 ranking influence.
   */
  readonly columns: ReadonlyArray<TsvTriggerColumnConfig>;
  /**
   * ts_config — use 'simple' for language-agnostic stemming so
   * Swahili / Kiluo / other low-resource languages tokenise correctly.
   */
  readonly tsConfig?: 'simple' | 'english';
}

/**
 * Render the body of the trigger function — a stacked `setweight(...)`
 * expression assigning to `NEW.<targetColumn>`.
 */
export function renderTsvBody(config: TsvTriggerConfig): string {
  const tsConfig = config.tsConfig ?? 'simple';
  const stmts = config.columns.map((c) => {
    const exprRaw =
      c.cast === 'jsonb'
        ? `coalesce(NEW.${c.column}::text, '')`
        : `coalesce(NEW.${c.column}, '')`;
    return `setweight(to_tsvector('${tsConfig}', ${exprRaw}), '${c.weight}')`;
  });
  const joined = stmts.join(' ||\n    ');
  return `NEW.${config.targetColumn} := ${joined};`;
}

/**
 * Render the full `CREATE OR REPLACE FUNCTION` + `CREATE TRIGGER`
 * pair. Idempotent via `DROP TRIGGER IF EXISTS` first.
 */
export function renderTsvTriggerSql(config: TsvTriggerConfig): string {
  const fnName = `public.${config.name}_update`;
  const triggerName = `${config.name}_trigger`;
  const watchColumns = config.columns.map((c) => c.column).join(', ');

  return [
    `CREATE OR REPLACE FUNCTION ${fnName}()`,
    `RETURNS trigger`,
    `LANGUAGE plpgsql`,
    `AS $$`,
    `BEGIN`,
    `  ${renderTsvBody(config)}`,
    `  NEW.updated_at := NOW();`,
    `  RETURN NEW;`,
    `END;`,
    `$$;`,
    ``,
    `DROP TRIGGER IF EXISTS ${triggerName} ON ${config.table};`,
    `CREATE TRIGGER ${triggerName}`,
    `  BEFORE INSERT OR UPDATE OF ${watchColumns}`,
    `  ON ${config.table}`,
    `  FOR EACH ROW`,
    `  EXECUTE FUNCTION ${fnName}();`,
  ].join('\n');
}

/**
 * Canonical config for `core_entity` — matches what migration 0186
 * installs. Exposed for tests that introspect the generator output.
 */
export const CORE_ENTITY_TSV_CONFIG: TsvTriggerConfig = {
  table: 'core_entity',
  targetColumn: 'tsv',
  name: 'core_entity_tsv',
  tsConfig: 'simple',
  columns: [
    { column: 'display_name', weight: 'A' },
    { column: 'discriminator', weight: 'B' },
    { column: 'entity_type', weight: 'B' },
    { column: 'custom_fields', weight: 'C', cast: 'jsonb' },
  ],
};
