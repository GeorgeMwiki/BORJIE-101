# Authz Policy Codemap

**Last Updated:** 2026-05-22
**Module:** `packages/authz-policy/`
**Public entry:** `packages/authz-policy/src/index.ts`
**Tier scope:** platform spine (RBAC + ABAC + JWT)

## Purpose

The platform's authorisation kernel. Combines RBAC (system roles)
and ABAC (attribute-based predicates) behind a unified policy
engine. Provides JWT verification (`JwtService`), Hono middleware
(`requirePermission`, `requireRole`), TypeScript decorators for
service-method gating, and the policy DSL evaluator. RLS at the
database layer is the final defence-in-depth; authz-policy is the
first.

## Entry points

- `src/index.ts` — barrel.
- `src/jwt.service.ts` — `JwtService` (sign + verify, jose).
- `src/policy-engine.ts` — combined RBAC + ABAC evaluator.
- `src/rbac.engine.ts`, `src/abac.engine.ts` — sub-engines.
- `src/system-roles.ts` — built-in roles (admin, owner, manager, …).
- `src/middleware/`, `src/middleware.ts` — Hono middleware.
- `src/decorators.ts` — `@RequirePermission(...)` etc.
- `src/types.ts`, `src/domain-models.d.ts` — types.

## Internal structure

- `engine/` — extension points + condition combinators.
- `rbac.engine.ts` — role → permission resolver.
- `abac.engine.ts` — attribute predicate evaluator.
- `policy-engine.ts` — combines both with deny-overrides semantics.
- `middleware/` — extracts JWT, runs policy, attaches context.

## Dependencies

- Upstream: jose, `@borjie/domain-models`, Hono types.
- Downstream: api-gateway, every service that fronts requests,
  agent-platform.

## Common workflows

- **Verify a JWT** → `await jwtService.verify(token, opts)`.
- **Gate a route** → `app.use(requirePermission('lease:write'))`.
- **Gate a method** → `@RequirePermission('payment:approve')`.
- **Check attribute** → `policy.evaluate({ subject, resource, action })`.

## Anti-patterns to avoid

- Never decode JWT without verification (`jwt.decode` without verify).
- Never log the raw JWT or the JWKS response.
- Never trust the `tenantId` claim without the tenant-claim hardening
  middleware (Z-SUPA-F6).
- Never reuse a policy instance across tenants without scoping.

## Related codemaps

- [api-gateway.md](./api-gateway.md) — mounts middleware
- [database.md](./database.md) — RLS defence-in-depth
- [observability.md](./observability.md) — audit failures
