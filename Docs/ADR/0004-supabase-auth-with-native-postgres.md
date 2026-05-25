# ADR 0004 — Supabase Auth with native Postgres

- **Status:** Accepted
- **Date:** 2025-Q4 (backfilled 2026-05-18)

## Context

Borjie needed an auth platform that:

- Supports email, phone (SMS OTP), OAuth (Google, future Microsoft).
- Issues JWTs we can verify server-side without round-tripping.
- Plays well with Postgres RLS — the JWT must carry the claims RLS
  reads (`auth.uid()`, `auth.role()`).
- Has a clear data-residency story for TZ + EU customers.
- Doesn't lock us in if we need to migrate.

Options considered:

| Option | Verdict |
|---|---|
| Auth0 | Excellent SDK; pricing scales poorly at our growth curve; no native Postgres RLS hook |
| Clerk | Great UX; less control over Postgres-side claim propagation |
| Firebase Auth | Excellent for mobile; cross-cloud concern (we use AWS + Cloudflare) |
| Roll-our-own | Off the table; auth is too risky to roll |
| Supabase Auth | Selected |

The decisive factor: Supabase Auth (gotrue) writes user records to
the same Postgres database we use for everything else. The
JWT-claim-to-RLS-policy link is built-in. We do not need a separate
sync job.

## Decision

Use Supabase Auth as the auth provider. The JWTs are RS256-signed
by Supabase; we verify them with `SUPABASE_JWT_SECRET` (HS256
shared secret for the early phase). On verification, claims include
`(sub, email, phone, role, tenant_id)` where `tenant_id` is set by
the post-signup trigger.

For backend service-to-service calls (api-gateway → domain-services),
we issue our own RS256 JWTs separately (`JWT_ACCESS_SECRET`). These
are NOT Supabase-issued; they carry service identity, not user
identity.

## Consequences

**Positive:**

- Postgres RLS policies use `auth.uid()` natively.
- One database backup story.
- Supabase's hosted dashboard accelerates support tasks.
- We can migrate off Supabase by self-hosting gotrue + Postgres if
  needed.

**Negative:**

- Two JWT secrets to manage (`SUPABASE_JWT_SECRET` for user tokens,
  `JWT_ACCESS_SECRET` for service tokens).
- Some Supabase Auth flows (magic-link) need our own UI overlay to
  match design system.
- SMS OTP costs go up if Supabase changes its SMS pricing — we ship
  Twilio fallback as a hedge.

## Alternatives considered

We considered using Supabase exclusively for both user AND service
auth, but service-to-service needed a separate trust domain that
doesn't intermingle with user JWT validity windows.

## References

- `services/identity/`
- `Docs/SUPABASE_LIVE_TEST.md`
- `Docs/SECURITY.md`
- `.env.example` § A (Supabase keys)
