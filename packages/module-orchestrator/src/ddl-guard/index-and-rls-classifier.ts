/**
 * index-and-rls-classifier.ts — the CREATE INDEX and canonical RLS
 * DO-block branches of the DDL allowlist grammar (HARD RULE 1).
 *
 *   classifyCreateIndex — CREATE INDEX [IF NOT EXISTS] <name> ON
 *     <tenant_mod_…> with no subquery / cross-table reach / smuggled
 *     comment-literal in the tail.
 *
 *   classifyRlsDoBlock — a DO $tag$ … $tag$ block whose body may ONLY
 *     manipulate RLS (ENABLE/FORCE ROW LEVEL SECURITY, CREATE/DROP
 *     POLICY, REVOKE … FROM anon, FOREACH scaffolding). Any DROP TABLE /
 *     TRUNCATE / GRANT / CREATE FUNCTION/TRIGGER/EXTENSION / DML / hard-
 *     coded core table reference inside the body is a hard reject.
 *
 * Pure. No I/O.
 */

import { containsPlaceholder, type TokenizeResult } from './sql-tokenizer.js';
import {
  isCoreTable,
  isTenantNamespacedTable,
  pgIdentifierLimitError,
} from './identifier-policy.js';
import {
  type ClassifyResult,
  checkTableIdentifier,
  preview,
  rejectStmt,
  splitTopLevelCommas,
} from './classify-shared.js';

/** The only access methods a spawned-module index may use. */
const ALLOWED_INDEX_METHODS: ReadonlySet<string> = new Set([
  'btree',
  'hash',
  'gin',
  'gist',
  'brin',
]);

/** A bare, unquoted, lower-case column identifier. */
const BARE_COLUMN_RE = /^[a-z][a-z0-9_]*$/;

export function classifyCreateIndex(
  stmt: string,
  tenantId: string,
): ClassifyResult {
  const m = stmt.match(
    /^\s*CREATE\s+(UNIQUE\s+)?INDEX\s+(IF\s+NOT\s+EXISTS\s+)?([A-Za-z0-9_."]+)\s+ON\s+([A-Za-z0-9_."]+)\s*([\s\S]*)$/i,
  );
  if (!m || m[3] === undefined || m[4] === undefined) {
    return rejectStmt(`malformed CREATE INDEX: ${preview(stmt)}`);
  }
  // Over-length INDEX name wall (defence in depth — a 64-byte index name
  // silently truncates and could collide with another index).
  const idxLenErr = pgIdentifierLimitError(m[3], 'index name');
  if (idxLenErr) {
    return rejectStmt(idxLenErr);
  }
  const nsCheck = checkTableIdentifier(m[4], tenantId);
  if (!nsCheck.ok) return nsCheck;

  const tail = m[5] ?? '';
  if (containsPlaceholder(tail)) {
    return rejectStmt(
      `CREATE INDEX tail embeds a stripped comment/literal (smuggling): ${preview(stmt)}`,
    );
  }
  // FIX 2 — STRICT positive grammar for the index tail. Only a plain
  // column-list index with an optional access method and an optional
  // conservative IS [NOT] NULL partial predicate is accepted. Anything
  // else (functional/expression index, operator class, COLLATE, subquery,
  // pg_sleep, …) is HARD-REJECTED.
  const tailErr = checkIndexTail(tail);
  if (tailErr) return rejectStmt(`${tailErr}: ${preview(stmt)}`);

  return { ok: true, errors: [], kind: 'create-index' };
}

/**
 * Validate the tail of a CREATE INDEX (everything after `ON <table>`)
 * against the conservative positive grammar:
 *
 *   [USING (btree|hash|gin|gist|brin)] ( <col> [, <col>]* )
 *     [WHERE <pred>]
 *
 * where every `<col>` is a bare lower-case column identifier and the
 * optional partial predicate `<pred>` is one or more `<col> IS [NOT] NULL`
 * terms joined ONLY by `AND`. Returns an error string on any deviation,
 * else null. The compiler's two real shapes — `(tenant_id) WHERE
 * deleted_at IS NULL` and `(module_id, tenant_id) WHERE deleted_at IS
 * NULL` — and a bare `(grade_pct)` field index all pass.
 */
function checkIndexTail(rawTail: string): string | null {
  let tail = rawTail.trim();

  // Optional access method: `USING <method>` (method is a bare word).
  const usingMatch = tail.match(/^USING\s+([A-Za-z][A-Za-z0-9_]*)\s+([\s\S]*)$/i);
  if (/^USING\b/i.test(tail)) {
    if (!usingMatch || usingMatch[1] === undefined || usingMatch[2] === undefined) {
      return 'CREATE INDEX USING clause is malformed';
    }
    if (!ALLOWED_INDEX_METHODS.has(usingMatch[1].toLowerCase())) {
      return `CREATE INDEX uses a disallowed access method ${usingMatch[1]}`;
    }
    tail = usingMatch[2].trim();
  }

  // The column list must be the next token: `( … )`.
  if (!tail.startsWith('(')) {
    return 'CREATE INDEX must start with a parenthesised column list';
  }
  const close = matchParen(tail, 0);
  if (close === -1) {
    return 'CREATE INDEX column list is unbalanced';
  }
  const colList = tail.slice(1, close);
  const colErr = checkColumnList(colList);
  if (colErr) return colErr;

  // Anything after the column list must be ONLY an optional partial
  // predicate `WHERE <pred>`.
  const rest = tail.slice(close + 1).trim();
  if (rest.length === 0) return null;
  const whereMatch = rest.match(/^WHERE\s+([\s\S]+)$/i);
  if (!whereMatch || whereMatch[1] === undefined) {
    return 'CREATE INDEX has trailing tokens after the column list';
  }
  return checkPartialPredicate(whereMatch[1].trim());
}

/** Every item in a column list must be a bare lower-case column ident. */
function checkColumnList(colList: string): string | null {
  if (colList.trim().length === 0) {
    return 'CREATE INDEX column list is empty';
  }
  const items = splitTopLevelCommas(colList).map((c) => c.trim());
  if (items.some((c) => c.length === 0)) {
    return 'CREATE INDEX column list has an empty segment (leading/trailing/double comma not allowed)';
  }
  for (const item of items) {
    if (!BARE_COLUMN_RE.test(item)) {
      return `CREATE INDEX column list item is not a bare column identifier (no functions/expressions/operator-classes): ${item}`;
    }
  }
  return null;
}

/**
 * The partial predicate is limited to one or more `<bare_col> IS [NOT]
 * NULL` terms joined ONLY by `AND` (case-insensitive). No OR, no
 * comparison operators, no function calls, no parentheses.
 */
function checkPartialPredicate(pred: string): string | null {
  if (pred.includes('(') || pred.includes(')')) {
    return 'CREATE INDEX partial predicate may not contain parentheses';
  }
  const terms = pred.split(/\s+AND\s+/i).map((t) => t.trim());
  for (const term of terms) {
    if (!/^[a-z][a-z0-9_]*\s+IS\s+(NOT\s+)?NULL$/i.test(term)) {
      return `CREATE INDEX partial predicate term is not a conservative IS [NOT] NULL check: ${term}`;
    }
  }
  return null;
}

/** Index of the `)` matching the `(` at `open`, or -1 if unbalanced. */
function matchParen(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i += 1) {
    const ch = s[i];
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Defence-in-depth denylist scanned inside a DO body. FIX 1 makes any
 * author-supplied DO body impossible (the only accepted DO block must
 * byte-match the freshly-built canonical RLS block), so this list is a
 * SECONDARY net only. It is kept broad and hardened against DCL /
 * cluster-wide / role / system / policy-destroying statements an
 * attacker would reach for inside a DO $...$ EXECUTE format(...) escape.
 */
const FORBIDDEN_IN_DO: ReadonlyArray<{ readonly re: RegExp; readonly label: string }> = [
  { re: /\bDROP\s+TABLE\b/i, label: 'DROP TABLE' },
  { re: /\bDROP\s+SCHEMA\b/i, label: 'DROP SCHEMA' },
  { re: /\bDROP\s+DATABASE\b/i, label: 'DROP DATABASE' },
  { re: /\bDROP\s+INDEX\b/i, label: 'DROP INDEX' },
  { re: /\bDROP\s+OWNED\b/i, label: 'DROP OWNED' },
  { re: /\bTRUNCATE\b/i, label: 'TRUNCATE' },
  { re: /\bGRANT\b/i, label: 'GRANT' },
  { re: /\bCREATE\s+(OR\s+REPLACE\s+)?FUNCTION\b/i, label: 'CREATE FUNCTION' },
  { re: /\bCREATE\s+(OR\s+REPLACE\s+)?TRIGGER\b/i, label: 'CREATE TRIGGER' },
  { re: /\bCREATE\s+EXTENSION\b/i, label: 'CREATE EXTENSION' },
  { re: /\bCREATE\s+ROLE\b/i, label: 'CREATE ROLE' },
  { re: /\bALTER\s+ROLE\b/i, label: 'ALTER ROLE' },
  { re: /\bDROP\s+ROLE\b/i, label: 'DROP ROLE' },
  { re: /\bALTER\s+SYSTEM\b/i, label: 'ALTER SYSTEM' },
  { re: /\bREINDEX\b/i, label: 'REINDEX' },
  { re: /\bCLUSTER\b/i, label: 'CLUSTER' },
  { re: /\bSECURITY\s+LABEL\b/i, label: 'SECURITY LABEL' },
  { re: /\bREASSIGN\s+OWNED\b/i, label: 'REASSIGN OWNED' },
  { re: /\bALTER\s+[A-Za-z_]+\s+[\s\S]*?\bOWNER\s+TO\b/i, label: 'ALTER … OWNER' },
  { re: /\bCOPY\b/i, label: 'COPY' },
  { re: /\bINSERT\b/i, label: 'INSERT' },
  { re: /\bDELETE\b/i, label: 'DELETE' },
  { re: /\bUPDATE\b/i, label: 'UPDATE' },
  { re: /\bALTER\s+TABLE\s+(?!public\.%I)/i, label: 'ALTER TABLE (non-parameterised)' },
];

export function classifyRlsDoBlock(
  stmt: string,
  tenantId: string,
  tok: TokenizeResult,
): ClassifyResult {
  // The DO body was stripped to a dollar-quote placeholder; recover the
  // raw body to prove it only manipulates RLS.
  const placeholderInStmt = tok.stripped
    .filter((s) => s.kind === 'dollar-quote')
    .find((s) => stmt.includes(s.placeholder.trim()));
  if (!placeholderInStmt) {
    return rejectStmt(`DO block without a recognisable body: ${preview(stmt)}`);
  }
  const body = placeholderInStmt.raw;

  for (const f of FORBIDDEN_IN_DO) {
    if (f.re.test(body)) {
      return rejectStmt(`forbidden ${f.label} inside DO block`);
    }
  }

  // `DROP POLICY` is permitted ONLY in the canonical parameterised form
  // `DROP POLICY [IF EXISTS] <name> ON public.%I` (so the guard block can
  // replace an existing policy). Any DROP POLICY targeting a concrete
  // table (e.g. `… ON public.tenants`) is a hand-rolled drop of a core
  // policy and is rejected.
  const dropPolicyErr = checkDropPolicyParameterised(body);
  if (dropPolicyErr) return rejectStmt(dropPolicyErr);

  // Tables may be referenced ONLY via the parameterised %I / the tenant
  // table array — any bare `public.<ident>` that is NOT `public.%I` and
  // is core or non-namespaced is rejected.
  const hardRefs = [...body.matchAll(/public\.([A-Za-z_][A-Za-z0-9_]*)/gi)]
    .map((x) => x[1])
    .filter((r): r is string => r !== undefined);
  for (const ref of hardRefs) {
    if (isCoreTable(ref) || !isTenantNamespacedTable(ref, tenantId)) {
      return rejectStmt(
        `DO block references a non-namespaced/core table public.${ref}`,
      );
    }
  }

  // Recover the FULL DO statement text by re-expanding the dollar-quote
  // placeholder (and any nested placeholders) back to the raw on-disk
  // body, so the validator can byte-compare against the freshly-built
  // canonical RLS block. The byte-compare — not this denylist — is the
  // primary wall.
  const recoveredText = recoverDoText(stmt, tok);

  return { ok: true, errors: [], kind: 'rls-do-block', recoveredText };
}

/**
 * Re-expand every stripped placeholder in the (leading-comment-stripped)
 * DO statement back to its exact raw text, restoring the byte-for-byte
 * on-disk DO block.
 *
 * The tokenizer substitutes each span as a SPACE-PADDED placeholder
 * (` @DDLGUARD_…_n@ `) — the surrounding single spaces are tokenizer
 * artifacts, not original bytes. So when re-expanding we consume AT MOST
 * one artifact space on each side of the placeholder, restoring the exact
 * original spacing (e.g. `DO  @…@` → `DO $ddlguard_rls$…`, single space).
 *
 * Placeholders are replaced longest-token-first so a longer index
 * (`@DDLGUARD_…_12@`) is not partially clobbered by a shorter one
 * (`@DDLGUARD_…_1@`).
 */
function recoverDoText(stmt: string, tok: TokenizeResult): string {
  let out = stmt;
  const spans = [...tok.stripped].sort(
    (a, b) => b.placeholder.trim().length - a.placeholder.trim().length,
  );
  for (const span of spans) {
    const token = span.placeholder.trim();
    if (!out.includes(token)) continue;
    // Consume one optional artifact space on each side of the token so
    // the recovered text byte-matches the un-tokenized original.
    const pattern = new RegExp(` ?${escapeRegex(token)} ?`, 'g');
    out = out.replace(pattern, () => span.raw);
    // Any residual bare occurrences (no surrounding space) get the raw too.
    if (out.includes(token)) {
      out = out.split(token).join(span.raw);
    }
  }
  return out;
}

/**
 * Reject any `DROP POLICY` inside the DO body that is NOT the canonical
 * parameterised form `DROP POLICY [IF EXISTS] <name> ON public.%I`. Each
 * occurrence is checked independently (so a hostile drop placed before a
 * legitimate parameterised one cannot hide behind it). Returns an error
 * string on the first non-conforming occurrence, else null.
 */
function checkDropPolicyParameterised(body: string): string | null {
  const occurrences = body.matchAll(/\bDROP\s+POLICY\b[\s\S]*?(?=;|$)/gi);
  for (const occ of occurrences) {
    const text = occ[0];
    if (
      !/^\s*DROP\s+POLICY\s+(IF\s+EXISTS\s+)?[A-Za-z_][A-Za-z0-9_]*\s+ON\s+public\.%I\s*$/i.test(
        text,
      )
    ) {
      return `non-parameterised DROP POLICY inside DO block (only DROP POLICY … ON public.%I is permitted)`;
    }
  }
  return null;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
