# Identity Service Codemap

**Last Updated:** 2026-05-22
**Module:** `services/identity/`
**Public entry:** `services/identity/src/index.ts`
**Tier scope:** platform spine (Universal Tenant Identity + multi-org)

## Purpose

The identity micro-service: universal tenant identities, multi-org
membership, invite codes, OTP. Resolves the Conflict-2 design: a
person can belong to multiple tenants/orgs without duplicate
account silos. Services accept injected repositories; constructing
a service without deps leaves methods rejecting with
`NOT_IMPLEMENTED` so legacy stub-era tests still pass.

## Entry points

- `src/index.ts` — barrel.
- `src/tenant-identity.service.ts` — `TenantIdentityService`,
  `VerifyOtpResult`, deps type.
- `src/invite-code.service.ts` — `InviteCodeService`,
  `GenerateInviteOptions`.
- `src/org-membership.service.ts` — `OrgMembershipService`.
- `src/postgres-*-repository.ts` — Postgres adapters.
- `src/otp/` — OTP store + transport adapter.
- `src/phone-normalize.ts` — E.164 normaliser.

## Internal structure

- `*.service.ts` — pure-domain services.
- `postgres-*-repository.ts` — Drizzle adapters implementing the
  service deps.
- `otp/` — generation + delivery + verification.

## Dependencies

- Upstream: `@borjie/database`, `@borjie/notifications-service`
  (OTP delivery), `@borjie/observability`.
- Downstream: api-gateway (auth routes), domain-services
  (customer / owner identity).

## Common workflows

- **Sign-in via OTP** →
  `tenantIdentity.requestOtp(phone)` → `verifyOtp(code)`.
- **Invite to org** →
  `inviteCode.generate({ orgId, role })` → email/SMS link.
- **Accept invite** → `inviteCode.redeem(code, userId)`.
- **Multi-org switch** → `orgMembership.listForUser(userId)`.

## Anti-patterns to avoid

- Never persist OTPs unhashed.
- Never log full phone numbers — use hashed lookup keys.
- Never reuse an invite code — single-use enforced.
- Never bypass the phone normaliser — leads to dup identities.

## Related codemaps

- [authz-policy.md](./authz-policy.md) — issues JWTs
- [database.md](./database.md) — identity schema + RLS
- [notifications-service.md](./notifications-service.md) — OTP delivery
