/**
 * ddl-allowlist-validator.ts — HARD RULE 1: the DDL allowlist (the
 * orchestration layer over the per-statement classifiers).
 *
 * `validateGeneratedDdl({ tenantId, migrationSql })` is the wall the
 * runtime DDL must pass before `MigrationApplyPort.applyMigration` may
 * ever execute it (a LATER pass wires the call site; Pass 1 ships the
 * predicate in isolation).
 *
 * Strategy — do NOT trust a regex-only scan. We:
 *
 *   1. Tokenize (sql-tokenizer): strip comments + string/dollar
 *      literals to opaque placeholders, split on TOP-LEVEL `;`. This
 *      makes comment/literal smuggling provable — a `'; DROP …` is a
 *      single literal, never a second statement.
 *   2. Classify each residual statement against a SMALL allowed
 *      grammar (hand-rolled classifiers, not free-text matching):
 *        (a) CREATE TABLE [IF NOT EXISTS] <tenant_mod_{tenantId}_slug>
 *            with safe column types only      → create-table-classifier
 *        (b) CREATE INDEX [IF NOT EXISTS] on a namespaced table
 *            + the canonical RLS DO-block      → index-and-rls-classifier
 *        (c) a pure comment-only statement
 *      ANY statement that is not exactly one of these is HARD-REJECTED.
 *   3. Enforce RLS-FORCE coverage (HARD RULE 2): every accepted table
 *      must be covered by a conforming FORCE-RLS block.
 *
 * Returns a structured result. On `ok:false` the caller NEVER applies.
 * On `ok:true` it returns the list of namespaced tables the DDL creates.
 * Pass 1 does NOT execute SQL.
 *
 * Pure. No I/O.
 */

import { tokenizeSql, type TokenizeResult } from './sql-tokenizer.js';
import { assertTenantIdShape } from './identifier-policy.js';
import {
  buildCanonicalRlsBlock,
  verifyRlsForced,
} from './rls-force-injector.js';
import { classifyCreateTable } from './create-table-classifier.js';
import {
  classifyCreateIndex,
  classifyRlsDoBlock,
} from './index-and-rls-classifier.js';
import {
  type ClassifyResult,
  preview,
  rejectStmt,
} from './classify-shared.js';

export interface ValidateGeneratedDdlInput {
  readonly tenantId: string;
  readonly migrationSql: string;
}

export interface ValidateGeneratedDdlResult {
  readonly ok: boolean;
  readonly errors: ReadonlyArray<string>;
  /** Tenant-namespaced tables the DDL creates (empty on rejection). */
  readonly createdTables: ReadonlyArray<string>;
}

/**
 * Top-level statement types that are ALWAYS forbidden. Checked on the
 * placeholder-normalized statement so a comment cannot pad the leading
 * keyword away. (REVOKE is forbidden at top level — the only legitimate
 * REVOKE lives inside the canonical RLS DO-block.)
 */
const BANNED_KEYWORDS: ReadonlyArray<{ readonly re: RegExp; readonly label: string }> = [
  { re: /^\s*DROP\b/i, label: 'DROP' },
  { re: /^\s*ALTER\b/i, label: 'ALTER' },
  { re: /^\s*TRUNCATE\b/i, label: 'TRUNCATE' },
  { re: /^\s*GRANT\b/i, label: 'GRANT' },
  { re: /^\s*REVOKE\b/i, label: 'REVOKE (outside the canonical RLS block)' },
  { re: /^\s*COPY\b/i, label: 'COPY' },
  { re: /^\s*CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\b/i, label: 'CREATE FUNCTION' },
  { re: /^\s*CREATE\s+(OR\s+REPLACE\s+)?TRIGGER\b/i, label: 'CREATE TRIGGER' },
  { re: /^\s*CREATE\s+(OR\s+REPLACE\s+)?PROCEDURE\b/i, label: 'CREATE PROCEDURE' },
  { re: /^\s*CREATE\s+EXTENSION\b/i, label: 'CREATE EXTENSION' },
  { re: /^\s*CREATE\s+SCHEMA\b/i, label: 'CREATE SCHEMA' },
  { re: /^\s*CREATE\s+(OR\s+REPLACE\s+)?(MATERIALIZED\s+)?VIEW\b/i, label: 'CREATE VIEW' },
  { re: /^\s*CREATE\s+ROLE\b/i, label: 'CREATE ROLE' },
  { re: /^\s*INSERT\b/i, label: 'INSERT' },
  { re: /^\s*UPDATE\b/i, label: 'UPDATE' },
  { re: /^\s*DELETE\b/i, label: 'DELETE' },
  { re: /^\s*SELECT\b/i, label: 'SELECT' },
  { re: /^\s*SET\b/i, label: 'SET' },
  { re: /^\s*MERGE\b/i, label: 'MERGE' },
  { re: /^\s*CALL\b/i, label: 'CALL' },
];

export function validateGeneratedDdl(
  input: ValidateGeneratedDdlInput,
): ValidateGeneratedDdlResult {
  const { tenantId } = input;
  try {
    assertTenantIdShape(tenantId);
  } catch (e) {
    return reject([(e as Error).message]);
  }

  const tok = tokenizeSql(input.migrationSql);
  if (tok.unterminated) {
    return reject([
      'unterminated comment/string/dollar-quote — possible smuggling; refusing to classify',
    ]);
  }

  const errors: string[] = [];
  // Ordered list of created tenant tables (drives the canonical RLS
  // block's table-array shape) and the recovered text of every DO block
  // seen in the migration (drives the byte-equals-canonical check).
  const createdTables: string[] = [];
  const doBlockTexts: string[] = [];

  for (const stmt of tok.statements) {
    const classified = classifyStatement(stmt, tenantId, tok);
    if (!classified.ok) {
      errors.push(...classified.errors);
      continue;
    }
    if (classified.kind === 'create-table' && classified.table) {
      createdTables.push(classified.table);
    }
    if (classified.kind === 'rls-do-block') {
      doBlockTexts.push(classified.recoveredText ?? '');
    }
  }

  if (createdTables.length === 0 && errors.length === 0) {
    errors.push('no CREATE TABLE statement found — nothing to spawn');
  }

  // FIX 1 — POSITIVE ALLOWLIST for the DO block. The DO block is NOT
  // judged by a denylist scan of its body (an author/tampered body can
  // hide a `DO $evil$ … EXECUTE format(…CREATE ROLE … SUPERUSER…) $evil$`
  // a denylist misses). Instead the ONLY accepted DO block must be
  // byte-identical to the freshly-built canonical RLS block:
  //   - at most ONE DO block, ever;
  //   - tables present  → EXACTLY ONE DO block, byte-equal to canonical;
  //   - tables present, zero DO blocks → reject (a table without RLS).
  if (errors.length === 0) {
    errors.push(...checkDoBlocks(tenantId, createdTables, doBlockTexts));
  }

  // HARD RULE 2 — every created table must be FORCE-RLS covered by the
  // canonical guard block and NOTHING else. tenantId is passed so the
  // located block is byte-compared against the freshly-built canonical
  // block (an author can never hand-roll a passing block).
  if (errors.length === 0) {
    const rls = verifyRlsForced(input.migrationSql, createdTables, tenantId);
    if (!rls.ok) errors.push(...rls.errors);
  }

  if (errors.length > 0) return reject(errors);
  return Object.freeze({
    ok: true,
    errors: Object.freeze([]),
    createdTables: Object.freeze([...new Set(createdTables)]),
  });
}

/**
 * FIX 1 — the positive DO-block rule. Returns the (possibly empty) list
 * of errors. A DO block is accepted ONLY when it is byte-identical to the
 * canonical RLS block this guard would itself build for the ordered set
 * of created tables; any deviation, a second DO block, or a missing DO
 * block when tables exist is a hard reject.
 */
function checkDoBlocks(
  tenantId: string,
  createdTables: ReadonlyArray<string>,
  doBlockTexts: ReadonlyArray<string>,
): string[] {
  if (doBlockTexts.length > 1) {
    return [
      `expected at most one canonical RLS DO block, found ${doBlockTexts.length} (author-supplied DO blocks are forbidden)`,
    ];
  }
  if (createdTables.length === 0) {
    // No tables → no RLS block expected. A stray DO block with no table
    // to protect is still rejected by the >1 / byte-compare paths above
    // and below; a zero/zero case is benign.
    return doBlockTexts.length === 0
      ? []
      : ['a DO block was supplied but no tenant table was created'];
  }
  if (doBlockTexts.length === 0) {
    return [
      'created tenant table(s) without the canonical FORCE-RLS DO block (RLS is mandatory)',
    ];
  }

  let canonical: string;
  try {
    canonical = canonicalDoStatement(tenantId, createdTables);
  } catch (e) {
    return [`cannot build canonical RLS block: ${(e as Error).message}`];
  }
  const supplied = doBlockTexts[0] ?? '';
  if (stripTrailingSemicolon(supplied) !== stripTrailingSemicolon(canonical)) {
    return [
      'the supplied RLS DO block is not byte-identical to the canonical guard block (author-modified/extra RLS is forbidden)',
    ];
  }
  return [];
}

/**
 * The canonical DO statement (the `DO $ddlguard_rls$ … $ddlguard_rls$;`
 * portion) for the given ordered tables — stripped of the leading
 * comment header `buildCanonicalRlsBlock` prepends, so it byte-matches
 * the recovered statement text (whose leading comment placeholders the
 * classifier already removed).
 */
function canonicalDoStatement(
  tenantId: string,
  tables: ReadonlyArray<string>,
): string {
  const built = buildCanonicalRlsBlock(tenantId, [...tables]);
  const doAt = built.indexOf('DO $ddlguard_rls$');
  if (doAt === -1) {
    throw new Error('canonical block missing its DO statement');
  }
  return built.slice(doAt);
}

function stripTrailingSemicolon(s: string): string {
  return s.replace(/;\s*$/, '');
}

function classifyStatement(
  stmt: string,
  tenantId: string,
  tok: TokenizeResult,
): ClassifyResult {
  // Comment-only statement: was entirely a stripped comment/placeholder.
  const withoutPlaceholders = stripPlaceholders(stmt).trim();
  if (withoutPlaceholders.length === 0) {
    return { ok: true, errors: [], kind: 'comment-only' };
  }

  // Banned top-level keywords (on the placeholder-normalized text so a
  // comment cannot pad the leading keyword away).
  for (const banned of BANNED_KEYWORDS) {
    if (banned.re.test(withoutPlaceholders)) {
      return rejectStmt(
        `forbidden statement type ${banned.label}: ${preview(stmt)}`,
      );
    }
  }

  // Drop ONLY leading comment placeholders so the structural classifiers
  // anchor on the real first keyword; embedded dollar/literal
  // placeholders deeper in the body survive for downstream recovery.
  const body = stripLeadingCommentPlaceholders(stmt, tok);

  if (/^\s*DO\b/i.test(body)) {
    return classifyRlsDoBlock(body, tenantId, tok);
  }
  if (/^\s*CREATE\s+TABLE\b/i.test(body)) {
    return classifyCreateTable(body, tenantId, tok);
  }
  if (/^\s*CREATE\s+(UNIQUE\s+)?INDEX\b/i.test(body)) {
    return classifyCreateIndex(body, tenantId);
  }
  return rejectStmt(`statement not in the allowed grammar: ${preview(stmt)}`);
}

/**
 * Remove leading comment placeholders (and surrounding whitespace) from
 * the head of a statement so the structural classifier anchors on the
 * first real keyword. Stops at the first non-comment, non-whitespace
 * token — embedded placeholders deeper in the body are untouched.
 */
function stripLeadingCommentPlaceholders(
  stmt: string,
  tok: TokenizeResult,
): string {
  const commentPlaceholders = new Set(
    tok.stripped
      .filter((s) => s.kind === 'line-comment' || s.kind === 'block-comment')
      .map((s) => s.placeholder.trim()),
  );
  let s = stmt;
  for (;;) {
    const trimmed = s.replace(/^\s+/, '');
    const m = trimmed.match(/^(@DDLGUARD_[A-Z_]+_\d+@)/);
    if (!m || m[1] === undefined || !commentPlaceholders.has(m[1])) break;
    s = trimmed.slice(m[1].length);
  }
  return s.replace(/^\s+/, '');
}

function stripPlaceholders(s: string): string {
  // Placeholders are `@DDLGUARD_<KIND>_<n>@` (optionally space-padded).
  return s.replace(/\s?@DDLGUARD_[A-Z_]+_\d+@\s?/g, ' ');
}

function reject(errors: ReadonlyArray<string>): ValidateGeneratedDdlResult {
  return Object.freeze({
    ok: false,
    errors: Object.freeze([...errors]),
    createdTables: Object.freeze([]),
  });
}
