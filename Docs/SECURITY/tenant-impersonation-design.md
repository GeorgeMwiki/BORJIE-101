# Tenant Impersonation — Security Review & Design (NOT YET IMPLEMENTED)

**Status:** DESIGN / THREAT MODEL — no gateway route exists; the feature is
honest-disabled (404). Do **not** implement until this design is reviewed and
signed off by a second security-qualified reviewer.
**Risk class:** HIGH (cross-tenant auth-boundary crossing).
**Verdict up front:** **Requires four-eyes approval** (HIGH-risk policy prefix
`four_eye` / `sovereign`). Reuse the existing `admin_superpower_pending_approvals`
machinery; do **not** invent a parallel approval path.

---

## 1. Why this is HIGH-risk

A Borjie-HQ admin acting **as** a tenant is the single largest blast-radius
action in the platform: it crosses the tenant isolation boundary that *every*
other control (RLS FORCE, per-tenant audit chain, kill-switch) assumes is
inviolable. A naive "mint a tenant bearer" implementation would:

- defeat RLS by legitimately binding `app.current_tenant_id` to a foreign tenant,
- write rows into the tenant's data + audit chain that are **indistinguishable**
  from the tenant's own actions (no attribution to the real admin),
- be replayable / long-lived if it reuses the Supabase token shape.

So the token is **not** a tenant bearer. It is a distinct, short-lived,
single-use, scoped, attributable, revocable **impersonation grant**.

## 2. Current state (verified)

- FE hook `apps/admin-web/src/lib/internal/queries/tenants.ts → useImpersonate()`
  POSTs `/api/v1/mining/internal/tenants/:id/impersonate`. No gateway route →
  404. UI `TenantImpersonateTab.tsx` discloses "not yet wired." **Correct posture
  — keep it until sign-off.**
- Canonical auth: Supabase ES256 JWT verified via JWKS in
  `services/api-gateway/src/middleware/hono-auth.ts`. Claims used:
  `sub` (userId), `app_metadata.tenant_id`, `app_metadata.mining_role`. The
  middleware **throws** if a non-PUBLIC role has no `tenantId` (RLS GUC always
  bound). [hard rule: Supabase JWT is canonical auth — no Clerk]
- RLS: `databaseMiddleware` (`middleware/database.ts`) pins a reserved
  connection and runs `set_config('app.current_tenant_id', tenantId, false)`,
  fail-closed `RLS_CONTEXT_FAILED`. [hard rule: RLS FORCE-enabled; GUC bound by
  middleware; never disable / double-filter]
- Four-eye precedent: `routes/admin/superpowers.hono.ts` + table
  `admin_superpower_pending_approvals` + DB CHECK `admin_four_eye_distinct_actors_chk`
  (proposer ≠ approver enforced **in the database**) + `ADMIN_HIGH_RISK_ACTIONS`
  + `registerFourEyeQueueRoutes`.
- Audit chain: `composition/ai-audit-chain-repo.ts insertEntry(...)` — HMAC-pinned,
  append-only. [hard rule: append-only, no mutation]
- Kill-switch: `middleware/kill-switch.middleware.ts`, fail-closed. [hard rule:
  never catch + ignore]

## 3. Design

### 3.1 Token model — a distinct impersonation grant, NOT a tenant bearer

Mint a **gateway-signed** (not Supabase-minted) JWT, alg ES256, with a dedicated
key/issuer so it can never be confused with a user token and so revoking the key
revokes all grants. Claims:

| Claim | Value | Purpose |
|---|---|---|
| `sub` | the **real admin's** user id | the actor is always the admin, never the tenant |
| `act_as` | target `tenant_id` | the impersonated tenant — bound to RLS for this session ONLY |
| `impersonator_sub` | = `sub` (real admin) | redundant-but-explicit attribution claim every audit row copies |
| `imp_grant_id` | uuid of the approved grant row | links token → approval record → revocation |
| `imp_scope` | `read` \| `read_write` | scope (default `read`) |
| `imp_surfaces` | allow-list of route prefixes | surface scope (e.g. `["/mining/licences","/owner/brief"]`) |
| `iat` / `exp` | now / now+**10 min** | short-lived; non-renewable |
| `jti` | uuid | single-use / replay tracking |
| `role` | a **reduced** impersonation role, never the tenant's own admin role | privilege floor, not the tenant's full role |

Hard limits baked into the token: **TTL ≤ 10 minutes, single-use issuance,
non-refreshable**. A new grant requires a new four-eye approval.

### 3.2 Issuance flow — four-eye gated (reuse existing machinery)

1. Admin A calls `POST /mining/internal/tenants/:id/impersonate-request`
   `{ reason, scope, surfaces, ttlSeconds≤600 }`. This **does not** issue a token.
   It inserts a row into `admin_superpower_pending_approvals` with action
   `impersonate_tenant` (added to `ADMIN_HIGH_RISK_ACTIONS`) + appends an audit
   entry (`impersonation.requested`). Kill-switch checked **before** insert
   (fail-closed). Tenant notified at this step (§3.5).
2. Admin B (distinct — enforced by `admin_four_eye_distinct_actors_chk`) approves
   via the existing four-eye queue route. On approval the gateway mints the token
   (§3.1), appends `impersonation.issued` to the audit chain (with both admin ids,
   reason, scope, target tenant), and returns it **once** to Admin A. The grant
   row stores `issued_at`, `expires_at`, `revoked_at`, `consumed_jti`.
3. No standing/auto-impersonation. No service-account bypass. CI/cron paths never
   mint these.

### 3.3 RLS interaction — bind target tenant for the session ONLY

- `authMiddleware`: when a token carries `act_as`, it builds an AuthContext with
  `tenantId = act_as`, `userId = sub (admin)`, plus an `impersonation` block
  `{ impersonatorSub, grantId, scope, surfaces, jti }`. It **must reject** any
  token that has `act_as` but is not gateway-issued / not from the impersonation
  key (defends against a forged user token smuggling `act_as`).
- `databaseMiddleware`: binds `app.current_tenant_id = act_as` exactly as today
  (`set_config(..., false)` on the reserved connection). **No widening** — the GUC
  is a single value; impersonation NEVER sets a wildcard or a second tenant. RLS
  FORCE still does all isolation. Fail-closed unchanged.
- The GUC is scoped to the request's reserved connection and cleared on release —
  impersonation cannot leak into another request.

### 3.4 Scope limits

- **Default read-only** (`imp_scope=read`): a new middleware rejects any
  non-idempotent method (POST/PUT/PATCH/DELETE) for read grants → `403
  IMPERSONATION_READ_ONLY`.
- **Write** (`imp_scope=read_write`) requires it to be named explicitly in the
  request AND is itself a higher four-eye bar (consider mandatory tenant
  pre-consent, §3.5). Even with write, the `imp_surfaces` allow-list gates which
  route prefixes are reachable; everything else → `403 IMPERSONATION_OUT_OF_SCOPE`.
- HARD-DENY surfaces regardless of scope: anything that issues credentials, rotates
  secrets, changes billing/payout destinations, exports bulk PII, or touches the
  ledger money path (`LedgerService.post`). Impersonation must never move money.

### 3.5 Audit + notification + consent

- **Audit (mandatory, fail-closed):** append to the hash-chained `ai_audit_chain`
  on `impersonation.requested`, `.approved/issued`, `.revoked`, `.expired`, and on
  **every impersonated mutation** (the action-audit recorder copies
  `impersonator_sub` + `grant_id` + `jti` into the row, so the chain attributes the
  action to the real admin, not the tenant). If the audit append fails, the action
  fails (append-only + fail-closed; never silently proceed). [hard rules]
- **Notification + consent policy (recommend):**
  - Tenant owner is **notified on request** and **on issue** (email + in-app), with
    admin identity, reason, scope, TTL.
  - **Read** grants: notify-only (transparency) is acceptable for legitimate
    support, but the tenant gets a visible "your account was accessed by Borjie
    support for <reason> at <time>" record they can audit.
  - **Write** grants: require **explicit tenant pre-consent** (a consent token /
    support-session the owner starts), OR a contractual break-glass clause with
    mandatory post-hoc disclosure within a fixed SLA. Default to consent-required;
    break-glass is a separate, even-higher-bar policy.

### 3.6 Kill-switch, rate-limit, revocation

- **Kill-switch:** a global + per-tenant `impersonation` kill-switch checked at
  request-time AND issue-time. Fail-closed (never catch+ignore). Flipping it
  invalidates live grants (see revocation).
- **Rate-limit:** per-admin and per-target-tenant caps (e.g. ≤ N active grants,
  ≤ M issuances/day), enforced server-side; exceed → refuse + alert.
- **Revocation:** `revoked_at` on the grant row + a short revocation cache the
  `authMiddleware` consults (the 10-min TTL bounds exposure even without it, but
  explicit revoke must be immediate). Revoke triggers: Admin B / security revokes;
  tenant revokes their own consent; kill-switch flip; anomaly detection. Token
  `jti` single-use prevents replay after consumption.

## 4. Threat model (abridged STRIDE)

| Threat | Vector | Mitigation |
|---|---|---|
| **Spoofing** | Forge a user JWT with `act_as` to self-impersonate | `act_as` honored ONLY on tokens signed by the dedicated impersonation key + gateway issuer; user/Supabase tokens with `act_as` are rejected |
| **Elevation** | Admin self-approves (proposer=approver) | DB CHECK `admin_four_eye_distinct_actors_chk` enforces distinct actors in the database, not just app code |
| **Tampering** | Edit audit rows to hide impersonated actions | Audit chain is HMAC-pinned + append-only; verifier recomputes; mutation breaks the chain |
| **Repudiation** | "It was the tenant, not me" | `impersonator_sub` + `grant_id` + `jti` copied into every audited row → non-repudiable attribution to the admin |
| **Info disclosure** | Long-lived/standing token harvested | TTL ≤ 10 min, single-use `jti`, non-refreshable, revocable; read-only default |
| **Scope creep** | Use a support grant to change payout/secrets/money | Hard-deny surfaces (credentials/secrets/billing/payout/ledger) regardless of scope; surface allow-list |
| **RLS bypass / widening** | Bind a wildcard or two tenants | GUC is a single value bound to `act_as`; never wildcarded; RLS FORCE unchanged; reserved-connection scoping |
| **DoS / abuse** | Mass impersonation | Per-admin / per-tenant rate limits + kill-switch fail-closed + alerting |
| **Replay** | Reuse a captured token | `jti` single-use + short TTL + revocation cache |
| **Insider (rogue admin)** | Quietly inspect a tenant | Four-eye (second admin must approve) + mandatory tenant notification + immutable audit + (write) consent |

## 5. Hard-rule compliance (CLAUDE.md)

- **Supabase JWT canonical:** user auth unchanged. Impersonation tokens are a
  *distinct*, clearly-separated gateway-issued grant — they do not replace or
  weaken Supabase verification; the middleware verifies them on a separate path
  and refuses `act_as` on any Supabase/user token. ✅
- **RLS FORCE / GUC bound by middleware / never disable or double-filter:** the
  GUC is bound to `act_as` for the session only; isolation stays in the DB. ✅
- **Audit chain append-only, hash-chained:** every step + every impersonated
  mutation appends; attribution via `impersonator_sub`. No mutation. ✅
- **Kill-switch fail-closed:** checked at issue + request time; never catch+ignore. ✅

## 6. Four-eyes recommendation

**YES — impersonation MUST be a four-eye, HIGH-risk action.** Register
`impersonate_tenant` in `ADMIN_HIGH_RISK_ACTIONS`, route it through
`admin_superpower_pending_approvals` + `admin_four_eye_distinct_actors_chk`, and
treat it under the `four_eye` / `sovereign` HIGH-risk policy prefix in the policy
gate (literal policy rule, no reason-resolver generalisation). Write-scope and
break-glass are even higher bars (tenant consent / time-boxed disclosure).

## 7. Implementation checklist (ONLY after sign-off)

1. Migration: `admin_tenant_impersonation_grants` (grant_id, admin_sub,
   target_tenant_id, scope, surfaces[], reason, issued_at, expires_at, consumed_jti,
   revoked_at, revoked_by) — FORCE RLS / HQ-scoped; immutable history.
2. Add `impersonate_tenant` to `ADMIN_HIGH_RISK_ACTIONS`; wire request → four-eye
   queue → approve → mint.
3. Dedicated ES256 impersonation signing key (separate from Supabase) + issuer.
4. `authMiddleware`: parse + verify impersonation tokens; build impersonation
   AuthContext; refuse `act_as` on user tokens.
5. Read-only + surface-allow-list + hard-deny middleware.
6. Audit recorder: copy `impersonator_sub`/`grant_id`/`jti` into every row.
7. Kill-switch + rate-limit + revocation cache + tenant notification/consent.
8. Tests: distinct-actor enforcement, TTL/replay, read-only denial, hard-deny
   surfaces, RLS-bound-to-target-only, audit attribution, kill-switch fail-closed,
   revocation immediacy.

## 8. Open questions for the reviewer

1. Read-only-notify vs write-requires-consent: where exactly is the line, and is
   contractual break-glass (post-hoc disclosure) acceptable for incident response?
2. Should impersonation be **disabled in production** entirely at launch and only
   enabled per-incident behind a flag + kill-switch?
3. Signing-key custody + rotation cadence for the impersonation key.
4. Do we need a hard cap on *total* concurrent platform-wide impersonations?

**Recommendation for launch:** ship with impersonation **off** (keep the 404 /
honest-disabled UI). It is **not** required for the paying-user launch path. Wire
it later, behind this design + a second reviewer's sign-off + four-eyes.
