# ADR 0007 — Supabase Auth + self-hosted Postgres

- **Status:** Accepted
- **Date:** 2026-03 (Z-SUPA audit, see TaskList 74-80)

## Context

We need: JWT-based auth with social + OTP, server-side verification,
and a Postgres database we control completely (RLS, pgvector,
custom migrations, regional placement). Pure Supabase-managed
Postgres locks us out of operational primitives we need; pure
self-hosted auth forces us to rebuild what Supabase already does
well.

Options considered:

| Option | Verdict |
|---|---|
| Pure Supabase (auth + db) | DB customisation limits + region pinning friction |
| Pure self-hosted (custom auth + db) | Rebuilds known-good auth poorly |
| Clerk auth + own Postgres | Clerk pricing + vendor concentration risk |
| Supabase Auth + self-hosted Postgres | Selected |

## Decision

Use Supabase Auth as the JWT/OTP/social provider; verify Supabase
JWTs server-side in `api-gateway` via the jose library against the
Supabase JWKS. Persist all domain data in our self-hosted Postgres
(with pgvector, RLS, 184+ Drizzle migrations). The RLS GUC name is
`app.user_id` / `app.tenant_id` (see Z-SUPA-F2 fix).

## Consequences

**Positive:**

- Auth surface is hardened by Supabase (rate limits, leak detection).
- We retain full control of the database (region, tuning, migrations).
- JWT verification is local — no extra hop on hot path.
- Tenant claim hardening (Z-SUPA-F6) prevents cross-tenant claim
  forgery.

**Negative:**

- Two-vendor story: Supabase outage affects sign-in but not
  service-to-service.
- Operators must keep Supabase project, JWT issuer, audience, and
  JWKS URL in env (`SUPABASE_JWT_*`).
- The composition adds latency on cold start; mitigated by JWKS cache.

## Alternatives considered

We considered Clerk; pricing at our scale + privacy posture (data
residency for TZ/KE/NG customers) made Supabase the better fit.

## References

- `services/api-gateway/src/auth/supabase-jwt.ts`
- `packages/database/src/migrations/0157-0171_force_rls.sql`
- Z-SUPA audit set: tasks 74-80
- `Docs/SECURITY.md` § JWT verification
