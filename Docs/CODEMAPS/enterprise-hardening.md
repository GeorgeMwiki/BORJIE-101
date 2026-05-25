# Enterprise Hardening Codemap

**Last Updated:** 2026-05-22
**Module:** `packages/enterprise-hardening/`
**Public entry:** `packages/enterprise-hardening/src/index.ts`
**Tier scope:** platform spine (cross-cutting non-functional)

## Purpose

The grab-bag of cross-cutting enterprise concerns that don't belong
in any single domain: SOC 2 control registry, GDPR/CCPA privacy
controls, DSR workflows, retention policies, circuit breakers, rate
limiters, health checks, disaster-recovery coordination, multi-layer
caching, FinOps cost tracking, webhook delivery primitives, and the
custom-workflows engine. Wired into the api-gateway middleware
chain.

## Entry points

- `src/index.ts` — barrel.
- `src/compliance/` — `SOC2ControlRegistry`,
  `SOC2ComplianceManager`, evidence builders.
- `src/resilience/` — circuit breaker + rate limiter +
  disaster-recovery coordinator.
- `src/performance/` — cache + resource monitor + FinOps.
- `src/enterprise/` — webhook delivery, partner API gateway,
  workflows engine.
- `src/http/` — server-side middleware.

## Internal structure

- `compliance/` — SOC 2 + GDPR + DSR.
- `resilience/` — non-functional patterns.
- `performance/` — cache + monitoring.
- `enterprise/` — high-level enterprise features.
- `http/` — Hono middleware.

## Dependencies

- Upstream: `@borjie/observability`, `@borjie/config`,
  ioredis, drizzle.
- Downstream: api-gateway (middleware), every service via metrics.

## Common workflows

- **Wrap a flaky external call** → `circuitBreaker.execute(() => ...)`.
- **Add a SOC 2 control** →
  `SOC2ControlRegistry.register({ id, category, status })`.
- **DSR export** → `gdpr.exportSubjectData(userId, tenantId)`.
- **Health** → `healthChecker.aggregate()` → `/healthz/dependencies`.

## Anti-patterns to avoid

- Never bypass the circuit breaker for "just one call".
- Never cache PII without the privacy posture guard.
- Never persist DSR output beyond retention TTL.
- Never duplicate rate-limiter logic per-route — use middleware.

## Related codemaps

- [observability.md](./observability.md) — audit + metrics
- [api-gateway.md](./api-gateway.md) — wires middleware
- [database.md](./database.md) — DSR + retention tables
