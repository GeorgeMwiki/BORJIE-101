/**
 * @name Repository call missing tenantId
 * @description
 *   Flags calls to repository methods (`findById`, `findMany`, `findByCustomer`,
 *   `findByExternalId`) where no argument named or shaped like `tenantId`
 *   appears. BORJIE is multi-tenant; every persistence-layer lookup MUST
 *   be tenant-scoped or it is a data-isolation vulnerability (CWE-639).
 *
 *   This is the deep CodeQL counterpart to the Semgrep
 *   `missing-tenant-id-arg` rule. CodeQL gives us a full dataflow graph so
 *   we can also catch cases where `tenantId` *was* the second argument but
 *   was sourced from `req.body` (caller-controlled) rather than a trusted
 *   auth context. That refinement is TODO; this query is the v1 syntactic
 *   pass that mirrors Semgrep, and serves as a smoke test for the CodeQL
 *   query-pack pipeline.
 *
 * @kind problem
 * @problem.severity warning
 * @security-severity 7.5
 * @precision medium
 * @id js/borjie/missing-tenant-id
 * @tags security
 *       external/cwe/cwe-639
 *       borjie
 */

import javascript

/**
 * The set of repository-style method names that MUST always accept tenantId.
 */
class TenantScopedMethodName extends string {
  TenantScopedMethodName() {
    this = "findById" or
    this = "findMany" or
    this = "findByCustomer" or
    this = "findByExternalId"
  }
}

/**
 * A `MethodCallExpr` to one of the tenant-scoped repository methods.
 */
class TenantScopedCall extends MethodCallExpr {
  TenantScopedCall() {
    this.getMethodName() instanceof TenantScopedMethodName
  }
}

/**
 * Holds if the call site passes `tenantId` either as a named property on an
 * argument object, or as an identifier whose name contains "tenant".
 */
predicate hasTenantArgument(MethodCallExpr call) {
  exists(Expr arg, int i |
    arg = call.getArgument(i) and
    (
      // Identifier or property access whose name mentions "tenant".
      arg.toString().toLowerCase().matches("%tenant%")
      or
      // Object literal with a `tenantId` (or `tenant_id`) property.
      exists(Property p |
        p = arg.(ObjectExpr).getAProperty() and
        p.getName().toLowerCase().matches("tenant%")
      )
    )
  )
}

from TenantScopedCall call
where
  not hasTenantArgument(call)
  // Skip the repository implementations themselves (they define the methods).
  and not call.getFile().getRelativePath().regexpMatch(".*/repositories/.*\\.ts$")
  // Skip tests.
  and not call.getFile().getRelativePath().regexpMatch(".*\\.(test|spec)\\.(ts|tsx|js)$")
select
  call,
  "Repository call `" + call.getMethodName() + "` has no `tenantId` argument; " +
  "cross-tenant lookup risk. Add the caller's auth-context tenantId."
