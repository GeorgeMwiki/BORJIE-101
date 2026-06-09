/**
 * ddl-guard — the PURE security core for dynamic per-tenant
 * module-spawning (runtime DDL).
 *
 * Pass 1 ships the security model in ISOLATION — proven before any
 * wiring. There is NO DB write, NO migration, NO runtime DDL execution,
 * and NO mount into the package's public `src/index.ts` here.
 *
 * The wall, in three hard rules:
 *
 *   HARD RULE 1 — DDL ALLOWLIST (`validateGeneratedDdl`)
 *     Tokenize → classify each statement against a tiny allowed grammar
 *     (CREATE TABLE with safe column types only + CREATE INDEX on
 *     tenant-namespaced tables + the canonical RLS DO-block + pure
 *     comments). Hard-reject DROP / ALTER-core / TRUNCATE / GRANT /
 *     COPY / functions / triggers / extensions / multi-statement
 *     smuggling / cross-namespace references / comment- and
 *     string-literal-smuggling / disallowed column types / arbitrary
 *     DEFAULT expressions.
 *
 *   HARD RULE 2 — RLS-FORCE auto-inject (`buildCanonicalRlsBlock`,
 *     `verifyRlsForced`)
 *     Every spawned table gets ENABLE + FORCE ROW LEVEL SECURITY + a
 *     tenant_isolation policy on `app.current_tenant_id` +
 *     service_role_bypass + REVOKE anon. A module author cannot opt out.
 *
 *   HARD RULE 3 — four-eye / K5 gate (`assertApplyApproved`)
 *     A pure predicate over the existing four-eye approval record:
 *     status approved, module-spawn action, proposer != approver, bound
 *     to the exact spec SQL hash, not already executed.
 *
 * ─────────────────────────────────────────────────────────────────────
 * STRICTLY OUT OF SCOPE this pass (documented, NOT built here):
 *   - Aligning `module-spec-engine/compile.ts` to the canonical
 *     `tenant_mod_{tenantId}_` prefix + this RLS block shape.
 *   - The real `MigrationApplyPort` impl (SET LOCAL app.current_tenant_id
 *     + single txn + rollback + the
 *     `packages/database/src/migrations/tenant-modules/{tenantId}/`
 *     on-disk writer).
 *   - The `packages/database` migration creating any module-registry
 *     tables.
 *   - `services/api-gateway` composition wiring + any `index.ts` mount.
 *   - Any live-DB apply; any git commit.
 * The immutable CORE migration chain (03xx) is UNTOUCHED — tenant-module
 * DDL is a SEPARATE, governed, tenant-namespaced runtime class.
 * ─────────────────────────────────────────────────────────────────────
 */

export {
  validateGeneratedDdl,
  type ValidateGeneratedDdlInput,
  type ValidateGeneratedDdlResult,
} from './ddl-allowlist-validator.js';

export {
  buildCanonicalRlsBlock,
  verifyRlsForced,
  TENANT_GUC,
  SERVICE_ROLE_GUC,
  type RlsVerifyResult,
} from './rls-force-injector.js';

export {
  assertApplyApproved,
  MODULE_SPAWN_TOOL_NAMES,
  type FourEyeApprovalView,
  type AssertApplyApprovedInput,
  type AssertApplyApprovedResult,
} from './four-eye-gate.js';

export {
  canonicalTenantTablePrefix,
  isTenantNamespacedTable,
  isCoreTable,
  CORE_TABLE_DENYLIST,
  assertTenantIdShape,
} from './identifier-policy.js';

export {
  isSafeColumnType,
  isSafeDefault,
  SAFE_BASE_TYPES,
  SAFE_PARAMETERISED_TYPES,
  SYSTEM_DEFAULTS,
  type AllowlistResult,
} from './column-type-allowlist.js';

export {
  tokenizeSql,
  type TokenizeResult,
  type StrippedSpan,
  type StrippedSpanKind,
} from './sql-tokenizer.js';
