/**
 * dry-run.ts — `previewMigration(spec, tenantId)` — return generated
 * migration SQL WITHOUT applying it.
 *
 * Surface used by the `/api/v1/modules/:id/spec/preview` endpoint so a
 * tenant admin can review what they're about to apply before the K5
 * four-eye gate.
 */

import { compileSpec } from './compile.js';
import { type ModuleSpec, type CompileResult } from './types.js';

export interface DryRunResult {
  readonly ok: boolean;
  readonly migrationSql: string;
  readonly tableCount: number;
  readonly workflowCount: number;
  readonly uiSectionCount: number;
  readonly moneyFieldCount: number;
  readonly errors: readonly string[];
}

/**
 * Preview the migration that would be generated for {spec, tenantId}.
 *
 * Pure: invoking this NEVER touches the database.
 */
export function previewMigration(
  spec: ModuleSpec,
  tenantId: string,
): DryRunResult {
  const result = compileSpec(spec, tenantId);
  return Object.freeze({
    ok: result.ok,
    migrationSql: result.migrationSql,
    tableCount: spec.entities.length,
    workflowCount: spec.workflows.length,
    uiSectionCount: spec.ui_sections.length,
    moneyFieldCount: countMoneyFields(spec),
    errors: result.errors,
  });
}

function countMoneyFields(spec: ModuleSpec): number {
  let n = 0;
  for (const e of spec.entities) {
    for (const f of e.fields) {
      if (f.kind === 'money') n++;
    }
  }
  return n;
}

/**
 * Diff helper — given two CompileResults from successive spec versions,
 * report a coarse delta the K5 reviewer can scan.
 */
export interface SpecDiff {
  readonly addedTables: readonly string[];
  readonly removedTables: readonly string[];
  readonly changedTables: readonly string[];
}

export function diffCompileResults(
  before: CompileResult,
  after: CompileResult,
): SpecDiff {
  // The compiler emits one CREATE TABLE per entity; extract the table
  // names from each result's migrationSql.
  const beforeTables = new Set(extractTableNames(before.migrationSql));
  const afterTables = new Set(extractTableNames(after.migrationSql));

  const added: string[] = [];
  const removed: string[] = [];
  for (const t of afterTables) if (!beforeTables.has(t)) added.push(t);
  for (const t of beforeTables) if (!afterTables.has(t)) removed.push(t);

  // Changed: in both, but body differs. We compare per-table SQL chunks.
  const changed: string[] = [];
  for (const t of afterTables) {
    if (!beforeTables.has(t)) continue;
    const a = extractTableSql(before.migrationSql, t);
    const b = extractTableSql(after.migrationSql, t);
    if (a !== b) changed.push(t);
  }

  return Object.freeze({
    addedTables: Object.freeze(added),
    removedTables: Object.freeze(removed),
    changedTables: Object.freeze(changed),
  });
}

function extractTableNames(sql: string): readonly string[] {
  const matches = sql.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g);
  return Array.from(matches, (m) => m[1] ?? '').filter((n) => n.length > 0);
}

function extractTableSql(sql: string, tableName: string): string {
  const start = sql.indexOf(`CREATE TABLE IF NOT EXISTS ${tableName}`);
  if (start === -1) return '';
  const end = sql.indexOf(');', start);
  return end === -1 ? sql.slice(start) : sql.slice(start, end + 2);
}
