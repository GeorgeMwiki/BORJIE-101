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
import { isCoreTable, isTenantNamespacedTable } from './identifier-policy.js';
import {
  type ClassifyResult,
  checkTableIdentifier,
  preview,
  rejectStmt,
} from './classify-shared.js';

export function classifyCreateIndex(
  stmt: string,
  tenantId: string,
): ClassifyResult {
  const m = stmt.match(
    /^\s*CREATE\s+(UNIQUE\s+)?INDEX\s+(IF\s+NOT\s+EXISTS\s+)?([A-Za-z0-9_."]+)\s+ON\s+([A-Za-z0-9_."]+)\s*([\s\S]*)$/i,
  );
  if (!m || m[4] === undefined) {
    return rejectStmt(`malformed CREATE INDEX: ${preview(stmt)}`);
  }
  const nsCheck = checkTableIdentifier(m[4], tenantId);
  if (!nsCheck.ok) return nsCheck;

  const tail = m[5] ?? '';
  if (/\bSELECT\b/i.test(tail) || /\bFROM\b/i.test(tail)) {
    return rejectStmt(`CREATE INDEX must not contain a subquery: ${preview(stmt)}`);
  }
  if (containsPlaceholder(tail)) {
    return rejectStmt(
      `CREATE INDEX tail embeds a stripped comment/literal (smuggling): ${preview(stmt)}`,
    );
  }
  return { ok: true, errors: [], kind: 'create-index' };
}

const FORBIDDEN_IN_DO: ReadonlyArray<{ readonly re: RegExp; readonly label: string }> = [
  { re: /\bDROP\s+TABLE\b/i, label: 'DROP TABLE' },
  { re: /\bDROP\s+SCHEMA\b/i, label: 'DROP SCHEMA' },
  { re: /\bTRUNCATE\b/i, label: 'TRUNCATE' },
  { re: /\bGRANT\b/i, label: 'GRANT' },
  { re: /\bCREATE\s+(OR\s+REPLACE\s+)?FUNCTION\b/i, label: 'CREATE FUNCTION' },
  { re: /\bCREATE\s+(OR\s+REPLACE\s+)?TRIGGER\b/i, label: 'CREATE TRIGGER' },
  { re: /\bCREATE\s+EXTENSION\b/i, label: 'CREATE EXTENSION' },
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

  return { ok: true, errors: [], kind: 'rls-do-block' };
}
