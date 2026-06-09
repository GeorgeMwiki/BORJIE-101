/**
 * create-table-classifier.ts — the CREATE TABLE branch of the DDL
 * allowlist grammar (HARD RULE 1).
 *
 * Accepts ONLY:
 *   CREATE TABLE [IF NOT EXISTS] <tenant_mod_{tenantId}_slug> ( <cols> )
 * where every column is:
 *   - a safe allowlisted type (text/varchar(n)/integer/bigint/numeric(p,s)/
 *     boolean/timestamptz/date/uuid/jsonb)
 *   - with NO author-supplied DEFAULT (only the compiler's fixed system
 *     columns may carry the closed SYSTEM_DEFAULTS set)
 *   - with NO REFERENCES other than tenant_id→tenants, module_id→modules
 *   - with NO embedded comment placeholder (smuggling)
 *   - with NO column-level CHECK / GENERATED expression and NO table-level
 *     CHECK / CONSTRAINT … CHECK item. These expressions execute at
 *     write-time and are NOT part of the legal compile.ts output grammar;
 *     a hostile spec could otherwise smuggle a subquery into a core table
 *     (`CHECK (x IN (SELECT id FROM tenants))`), a stored generated column
 *     reading core (`GENERATED ALWAYS AS ((SELECT … FROM tenants)) STORED`),
 *     or an arbitrary function call (`CHECK (… pg_read_file(…) …)`). The
 *     keyword scan runs on the placeholder-NORMALISED stream so a CHECK /
 *     GENERATED hidden inside a string literal or comment is NOT falsely
 *     matched and a real one is never missed.
 *
 * Pure. No I/O.
 */

import type { TokenizeResult } from './sql-tokenizer.js';
import { isSafeColumnType, isSafeDefault } from './column-type-allowlist.js';
import { stripSchemaQualifier } from './identifier-policy.js';
import {
  type ClassifyResult,
  checkTableIdentifier,
  embedsComment,
  preview,
  rejectStmt,
  resolvePlaceholders,
  splitTopLevelCommas,
} from './classify-shared.js';

/** System columns the compiler emits; the only ones allowed a DEFAULT. */
const SYSTEM_COLUMNS: ReadonlySet<string> = new Set([
  'id',
  'tenant_id',
  'module_id',
  'display_name',
  'lifecycle_state',
  'created_at',
  'updated_at',
  'deleted_at',
]);

export function classifyCreateTable(
  stmt: string,
  tenantId: string,
  tok: TokenizeResult,
): ClassifyResult {
  const m = stmt.match(
    /^\s*CREATE\s+TABLE\s+(IF\s+NOT\s+EXISTS\s+)?([A-Za-z0-9_."]+)\s*\(([\s\S]*)\)\s*$/i,
  );
  if (!m || m[2] === undefined || m[3] === undefined) {
    return rejectStmt(`malformed CREATE TABLE: ${preview(stmt)}`);
  }
  const tableName = m[2];
  const body = m[3];

  const nsCheck = checkTableIdentifier(tableName, tenantId);
  if (!nsCheck.ok) return nsCheck;

  const columnDefs = splitTopLevelCommas(body)
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
  if (columnDefs.length === 0) {
    return rejectStmt(`CREATE TABLE has no columns: ${preview(stmt)}`);
  }

  const bareName = stripSchemaQualifier(tableName);
  const errors: string[] = [];
  for (const def of columnDefs) {
    errors.push(...validateColumnDef(def, bareName, tok));
  }
  if (errors.length > 0) {
    return { ok: false, errors: Object.freeze(errors) };
  }
  return { ok: true, errors: [], kind: 'create-table', table: bareName };
}

function validateColumnDef(
  rawDef: string,
  tableName: string,
  tok: TokenizeResult,
): string[] {
  const errors: string[] = [];
  const colName = rawDef.split(/\s+/)[0] ?? '';

  if (embedsComment(rawDef, tok)) {
    return [
      `column/constraint def embeds a stripped comment (smuggling): ${preview(rawDef)} on ${tableName}`,
    ];
  }

  // ── CHECK / GENERATED wall (scanned on the placeholder-NORMALISED
  // `rawDef`, so a CHECK/GENERATED keyword hidden inside a string literal
  // or comment is a placeholder — never falsely matched — while a real
  // structural one always is). Author-supplied CHECK / GENERATED
  // expressions are not part of the legal compile.ts grammar and would
  // run author SQL at write-time (subquery into a core table, stored
  // generated column reading core, arbitrary function call), so they are
  // HARD-REJECTED at BOTH column level and table level (a hostile spec
  // could push the expression to a `CONSTRAINT … CHECK (…)` or bare
  // `CHECK (…)` table item instead of a column).
  const tableLevel = tableLevelKind(rawDef);
  if (tableLevel !== null) {
    return [
      `table-level ${tableLevel} item is not in the allowed CREATE TABLE grammar (no author CHECK/GENERATED/CONSTRAINT … CHECK): ${preview(rawDef)} on ${tableName}`,
    ];
  }
  if (containsCheckOrGenerated(rawDef)) {
    return [
      `column ${colName} of ${tableName} carries a forbidden CHECK/GENERATED expression (not in the allowed grammar; executes author SQL at write-time): ${preview(rawDef)}`,
    ];
  }

  const def = resolvePlaceholders(rawDef, tok);

  // REFERENCES wall — only the canonical core FKs are permitted.
  const refMatch = def.match(/REFERENCES\s+([A-Za-z0-9_."]+)/i);
  if (refMatch && refMatch[1] !== undefined) {
    const target = stripSchemaQualifier(refMatch[1]).toLowerCase();
    const allowedFk =
      (colName === 'tenant_id' && target === 'tenants') ||
      (colName === 'module_id' && target === 'modules');
    if (!allowedFk) {
      return [
        `disallowed REFERENCES ${refMatch[1]} on column ${colName} of ${tableName} (only tenant_id→tenants, module_id→modules permitted)`,
      ];
    }
  }

  // DEFAULT wall — author defaults forbidden; system columns get the
  // closed SYSTEM_DEFAULTS set only.
  const defMatch = def.match(
    /\bDEFAULT\s+(.+?)(?:\s+NOT\s+NULL|\s+REFERENCES\b|$)/i,
  );
  if (defMatch && defMatch[1] !== undefined) {
    const d = isSafeDefault(defMatch[1].trim(), SYSTEM_COLUMNS.has(colName));
    if (!d.ok) errors.push(...d.errors.map((e) => `${tableName}.${colName}: ${e}`));
  }

  // Column-type wall.
  const typeFragment = extractTypeFragment(def);
  if (typeFragment === null) {
    errors.push(`cannot determine column type: ${preview(def)} on ${tableName}`);
    return errors;
  }
  const t = isSafeColumnType(typeFragment);
  if (!t.ok) errors.push(...t.errors.map((e) => `${tableName}.${colName}: ${e}`));

  return errors;
}

/**
 * True when the (placeholder-NORMALISED) item contains a structural
 * `CHECK` or any `GENERATED` clause — i.e. a column-level CHECK
 * constraint, a `GENERATED ALWAYS AS (…) STORED` computed column, or a
 * `GENERATED … AS IDENTITY` column. Word-boundary anchored so a column
 * whose NAME merely starts with those letters (e.g. `checksum`,
 * `generated_at`) is NOT matched. Because the scan runs on the
 * placeholder-normalised stream, a `CHECK`/`GENERATED` keyword hidden in
 * a stripped string literal or comment is a `@DDLGUARD_…@` placeholder
 * and can never match.
 */
function containsCheckOrGenerated(normalisedDef: string): boolean {
  return /\b(CHECK|GENERATED)\b/i.test(normalisedDef);
}

/**
 * Classify a table-body item that is a table-LEVEL constraint we forbid
 * (as opposed to a column definition). Returns the kind label when the
 * item is a `CONSTRAINT … CHECK (…)` or a bare `CHECK (…)` table
 * constraint, else null. Operates on the placeholder-normalised item.
 *
 * A table-level `CONSTRAINT … CHECK` or bare `CHECK` would otherwise let
 * a hostile spec relocate a forbidden write-time expression from a
 * column to a table item; both are rejected here. (Author table-level
 * constraints are not part of the legal compile.ts output grammar at
 * all — the compiler emits only the fixed system PRIMARY KEY on `id`,
 * inline column REFERENCES to tenants/modules, and per-column types.)
 */
function tableLevelKind(normalisedItem: string): string | null {
  const item = normalisedItem.trimStart();
  // `CONSTRAINT <name> CHECK (...)` — a named table-level check.
  if (/^CONSTRAINT\b/i.test(item)) {
    return /\bCHECK\b/i.test(item) ? 'CONSTRAINT … CHECK' : 'CONSTRAINT';
  }
  // Bare `CHECK (...)` table-level constraint.
  if (/^CHECK\b/i.test(item)) {
    return 'CHECK';
  }
  return null;
}

/**
 * Pull the bare type token from a column def. Handles
 *   `name TEXT NOT NULL`        → TEXT
 *   `name VARCHAR(120)`         → VARCHAR(120)
 *   `name NUMERIC(18, 4) …`     → NUMERIC(18, 4)
 *   `id TEXT PRIMARY KEY`       → TEXT
 *   `name TEXT … CHECK (…)`     → TEXT
 */
function extractTypeFragment(def: string): string | null {
  const firstSpace = def.search(/\s/);
  if (firstSpace === -1) return null;
  let rest = def.slice(firstSpace).trim();
  const cut = rest.search(
    /\b(NOT\s+NULL|PRIMARY\s+KEY|UNIQUE|DEFAULT|REFERENCES|CHECK|GENERATED|COLLATE)\b/i,
  );
  if (cut !== -1) rest = rest.slice(0, cut).trim();
  if (rest.length === 0) return null;
  return rest;
}
