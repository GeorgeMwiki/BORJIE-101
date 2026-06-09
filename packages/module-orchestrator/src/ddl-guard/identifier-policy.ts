/**
 * identifier-policy.ts — the tenant-namespace wall.
 *
 * Every table a spawned module may create MUST live inside a
 * per-tenant namespace so a runtime-spawned table can NEVER shadow,
 * alter, or reference a core platform table. This module is the single
 * source of truth for:
 *
 *   - the canonical tenant-namespace prefix `tenant_mod_{tenantId}_`
 *   - whether a given identifier is inside that namespace
 *   - whether a given identifier collides with a known core table
 *
 * It reuses `SLUG_REGEX` from the spec engine so the tenantId and the
 * module-table suffix obey the exact same grammar the LLM authoring
 * path is bound to — no second, looser identifier grammar can sneak in.
 *
 * Pure. No I/O.
 *
 * NOTE (scope): the existing compiler (`module-spec-engine/compile.ts`)
 * currently emits the legacy `module_{tenantId}_{slug}` prefix. Aligning
 * that compiler to this canonical `tenant_mod_` prefix is an explicitly
 * OUT-OF-SCOPE later pass (see ddl-guard/index.ts header). This Pass-1
 * guard defines and enforces the canonical shape in isolation.
 */

import { SLUG_REGEX } from '@borjie/module-spec-engine';

/** Canonical tenant-namespace prefix builder. */
export function canonicalTenantTablePrefix(tenantId: string): string {
  assertTenantIdShape(tenantId);
  return `tenant_mod_${tenantId}_`;
}

/**
 * Identifier grammar for a fully-qualified spawned table name:
 *   tenant_mod_{tenantId}_{slug}
 * where {tenantId} and {slug} both satisfy SLUG_REGEX. Built
 * dynamically per tenant so we never accept a foreign tenant's prefix.
 */
export function tenantTableRegex(tenantId: string): RegExp {
  assertTenantIdShape(tenantId);
  // SLUG_REGEX source is `^[a-z][a-z0-9_]{0,47}$`. We reuse only its
  // inner body for the trailing slug so the full-name grammar stays
  // anchored and length-bounded.
  return new RegExp(`^tenant_mod_${escapeRegex(tenantId)}_[a-z][a-z0-9_]{0,47}$`);
}

/**
 * True when `name` is a table identifier inside the given tenant's
 * module namespace. Case-sensitive on purpose: Postgres folds unquoted
 * identifiers to lower-case, and our grammar is lower-case only — an
 * upper-case identifier is therefore already non-conforming and
 * rejected, closing the "quoted mixed-case shadow" vector.
 */
export function isTenantNamespacedTable(name: string, tenantId: string): boolean {
  if (!isPlainIdentifier(name)) return false;
  const bare = stripSchemaQualifier(name);
  return tenantTableRegex(tenantId).test(bare);
}

/**
 * Known core/platform table names a spawned module must never name,
 * reference, or attempt to alter. This is a defence-in-depth denylist
 * layered ON TOP of the positive namespace allowlist — even if a future
 * bug widened the prefix check, naming any of these is a hard reject.
 *
 * Not exhaustive of the schema (the positive allowlist already excludes
 * everything outside the namespace); it captures the highest-value
 * invariant tables an attacker would target.
 */
export const CORE_TABLE_DENYLIST: ReadonlySet<string> = new Set([
  'tenants',
  'users',
  'modules',
  'module_specs',
  'module_templates',
  'sovereign_approvals',
  'killswitch_authorities',
  'pending_confirmations',
  'approval_policy_actions',
  'ledger_entries',
  'ledger_accounts',
  'disbursements',
  'core_entity',
  'entity_type_definition',
  'tenant_schema_extensions',
  'audit_events',
  'intelligence_corpus_chunks',
  'pg_catalog',
  'information_schema',
  'pg_policies',
  'pg_roles',
]);

export function isCoreTable(name: string): boolean {
  return CORE_TABLE_DENYLIST.has(stripSchemaQualifier(name).toLowerCase());
}

/**
 * Plain (unquoted, schema-less or public-qualified) identifier check.
 * A spawned-table identifier may be `name` or `public.name`. We reject
 * double-quoting, other schema qualifiers, and any character outside
 * `[a-z0-9_.]` so a quoted `"Mixed; Case"` smuggle cannot pass.
 */
export function isPlainIdentifier(name: string): boolean {
  if (typeof name !== 'string' || name.length === 0) return false;
  if (name.includes('"')) return false;
  // At most one schema qualifier, and it must be `public`.
  const parts = name.split('.');
  if (parts.length > 2) return false;
  if (parts.length === 2 && parts[0] !== 'public') return false;
  const bare = parts[parts.length - 1] ?? '';
  return /^[a-z][a-z0-9_]*$/.test(bare);
}

/** Strip an optional `public.` qualifier, returning the bare name. */
export function stripSchemaQualifier(name: string): string {
  const parts = name.split('.');
  return parts[parts.length - 1] ?? name;
}

/**
 * Assert the tenantId is itself slug-shaped. A non-slug tenantId can't
 * produce a safe prefix and is a programming/abuse error — throw.
 */
export function assertTenantIdShape(tenantId: string): void {
  if (typeof tenantId !== 'string' || !SLUG_REGEX.test(tenantId)) {
    throw new Error(
      `ddl-guard: tenantId must be slug-shaped (^[a-z][a-z0-9_]{0,47}$), got: ${JSON.stringify(
        tenantId,
      )}`,
    );
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
