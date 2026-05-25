# Security Review: BORJIE101 Waves 1-3

**Date:** 2026-04-18
**Reviewer:** Automated security review (security-reviewer agent)
**Scope:** Payments (GePG, ClickPesa, reconciliation), Payments-ledger arrears, Identity/OTP/invite-codes, API-gateway middleware + webhooks, authz-policy, PII-handling services
**Recommendation:** **BLOCK production release** until C-1, C-2, H-1, H-2, H-5 addressed.

---

## Executive Summary

**Risk Level:** HIGH — several CRITICAL findings around tenant isolation, API-key privilege escalation, GePG signature fallback, and JWT/HMAC configuration must block production release. The ledger and OTP designs are solid; the invite-code redeem path is correctly transactional. Webhook signature checks follow the right pattern for the three notification providers but have tactical defects.

**Tally**

| Severity | Count |
|---|---|
| CRITICAL (CVSS ≥9.0) | 2 |
| HIGH (CVSS 7.0–8.9) | 6 |
| MEDIUM (CVSS 4.0–6.9) | 9 |
| LOW (CVSS <4.0) | 6 |

---

## Critical Findings

### C-1. API-key auth grants SUPER_ADMIN with attacker-controlled tenantId
**Severity:** CRITICAL (CVSS ~9.1)
**Category:** Broken Access Control / Privilege Escalation
**Location:** `services/api-gateway/src/middleware/auth.middleware.ts:459-466` and `:482-488`

`apiKeyAuthMiddleware` and `flexibleAuthMiddleware` both create an auth context with hardcoded `role: 'SUPER_ADMIN'`, `permissions: ['*']`, and `tenantId: c.req.header('X-Tenant-ID') || 'system'`. Any holder of a valid API key can forge `X-Tenant-ID` and operate as SUPER_ADMIN in any tenant.

**Impact:** Attacker with one leaked API key can drain funds by approving arrears waivers, issue GePG control numbers for arbitrary bills, read all PII.

**Fix:** DB-backed API-key registry with per-key `{tenantId, role, scopes}`. Forbid `X-Tenant-ID` override.

### C-2. GePG direct signature verification returns stub in `rsa-gepg` mode
**Severity:** CRITICAL (CVSS ~9.0)
**Category:** Insufficient Verification of Data Authenticity
**Location:** `services/payments/src/providers/gepg/gepg-signature.ts:58-62`

In `rsa-gepg` mode, `verifyGepgSignature` returns `{ valid: false, reason: 'rsa_gepg_not_implemented' }` as a stub. The production `gepg-rsa-signature.ts` implementation exists but is not wired into `gepg-provider.ts`. Also, regex-based canonicalization in `gepg-rsa-signature.ts:30-37` is brittle — nested `gepgSignature` tags could confuse `lastIndexOf('</')`.

**Fix:** Wire `gepg-rsa-signature.ts` into `gepg-signature.ts`. Add startup assertion that either `GEPG_PSP_MODE=true` or both `GEPG_SIGNING_KEY_PEM + GEPG_SIGNING_CERT_PEM` are set. Replace regex canonicalization with `xml-crypto` behind feature flag.

---

## High Findings

### H-1. Cross-tenant spoofing via X-Tenant-ID header in Express auth path
**Severity:** HIGH (CVSS 8.1)
**Location:** `services/api-gateway/src/middleware/auth.middleware.ts:229-246`

`extractTenantId` falls back to `X-Tenant-ID` header, then `?tenantId=` query string, when the JWT lacks `tenantId`. No env gate — query string accepted in production.

**Fix:**
```ts
function extractTenantId(c, payload) {
  if (!payload?.tenantId) return null;  // hard-require JWT claim
  return payload.tenantId;
}
```

### H-2. `ensureTenantIsolation` middleware defined but never applied
**Severity:** HIGH (CVSS 7.5)
**Location:** `services/api-gateway/src/middleware/tenant-context.middleware.ts:480-504`

The middleware exists but is not mounted in `index.ts`. Handlers rely on developers remembering to scope by `auth.tenantId`.

**Fix:** Apply globally after auth, or inline-assert in every mutating route.

### H-3. Webhook secrets not asserted at startup
**Severity:** HIGH (CVSS 7.5)
**Location:** `services/api-gateway/src/routes/notification-webhooks.router.ts:40-44`

Missing `AFRICASTALKING_WEBHOOK_SECRET`, `TWILIO_AUTH_TOKEN`, `META_APP_SECRET` cause webhooks to silently 401. Ops engineers may "temporarily" bypass the verifier.

**Fix:** Fail startup when `NODE_ENV=production` and any webhook secret is missing.

### H-4. Meta webhook hex validation not strict
**Severity:** HIGH (CVSS 7.1)
**Location:** `services/api-gateway/src/routes/notification-webhooks.router.ts:65-71`

`verifyMeta` strips `sha256=` prefix but doesn't validate remaining chars are hex. `Buffer.from(providedHex, 'hex')` silently truncates at first invalid byte.

**Fix:** Validate header matches `/^sha256=[0-9a-f]{64}$/i` before processing.

### H-5. OTP storage default is in-memory
**Severity:** HIGH (CVSS 7.4)
**Location:** `services/identity/src/otp/otp-service.ts:60-74, 141-174`

`InMemoryOtpStore` + `NoopSmsDispatcher` defaults mean in multi-node deploys the verify request may hit a different node than the issue request. Attempt counter is per-node — distributed brute force possible.

**Fix:**
```ts
if (process.env.NODE_ENV === 'production' && store instanceof InMemoryOtpStore) {
  throw new Error('OtpService: InMemoryOtpStore not permitted in production');
}
```
Also add per-phone and per-IP rate limits on OTP endpoints.

### H-6. Invite-code redeem doesn't retry on serialization failures
**Severity:** HIGH (CVSS 7.0)
**Location:** `services/identity/src/postgres-invite-code-repository.ts:221-293`

Under `SERIALIZABLE` isolation, concurrent inserts can serialize-fail (`40001`). Callers see intermittent `INVITE_CODE_REVOKED`-style errors. Error codes thrown as string via `.message` — brittle for callers.

**Fix:** Add `40001` retry loop (3 attempts with jitter). Introduce `InviteCodeError` class with typed code enum.

---

## Medium Findings (summaries)

- **M-1.** Idempotency key scope is `(tenantId or 'anon')` — forge `'anon'` scope to replay another client's response.
- **M-2.** Idempotency cache stores response bodies in plaintext for 24h — PII exposure if Redis dump.
- **M-3.** JWT HS256 pinning good, but symmetric key shared across services. Production-grade = RS256/ES256 with JWKS. `tokenBlocklist` is in-memory — revocations don't survive restarts.
- **M-4.** `defaultTanzaniaBackend()` silently defaults to `clickpesa` when env unset.
- **M-5.** ClickPesa webhook raw-body capture not enforced in a router yet.
- **M-6.** Sandbox control numbers use deterministic 32-bit hash — collision possible.
- **M-7.** `Host` header fallback in `tenant-context.middleware.ts:254-262` is spoofable.
- **M-8.** Token-containing objects not banned from logger calls — future regression risk.
- **M-9.** `financial-profile-service.ts` uses `Date.now()+randomHex(4)` IDs — predictable + collide-prone.

---

## Low Findings (summaries)

- **L-1.** Regex canonicalization in GePG signature is brittle but safe against XXE.
- **L-2.** Tigopesa callback uses regex XML parsing — attribute-bearing tags silently missed.
- **L-3.** `allowedOrigins` accepts any no-origin request — hides compromised internal-service misbehavior.
- **L-4.** Error handler exposes `err.message` only in dev — correct.
- **L-5.** `financial-profile-service.ts` doesn't assert `statement.tenantId === input.tenantId` on update.
- **L-6.** `matcher.ts::fuzzyMatch` has no length cap on `customerName` — DoS amplifier under bulk reconcile.

---

## Per-Area Recommendations

### Payments
- Wire `gepg-rsa-signature.ts` into `gepg-signature.ts` before enabling `rsa-gepg` mode (C-2).
- Add signature header allowlist: `/^sha256=[0-9a-f]{64}$/i` (H-4).
- Replace minimal canonicalization with `xml-crypto` behind feature flag.
- Fail startup when `TANZANIA_PAYMENT_BACKEND` is unset in production (M-4).
- Require signed request bodies captured via raw-body middleware for all PSP webhooks (M-5).

### Payments-ledger / Arrears
- Immutability design is correct — new objects, never mutation.
- Add DB-level `CHECK` constraint: `redemptions_used >= 0 AND <= max_redemptions`.
- Emit audit event when `arrears-projection-service.ts:72-85` drops cross-tenant entries.

### Auth / Identity
- Fix tenantId extraction to strictly use JWT claim (H-1).
- Mount `ensureTenantIsolation` globally (H-2).
- Scope API keys per-tenant (C-1).
- Production assertion: `store` not `InMemoryOtpStore` (H-5).
- Per-phone and per-IP rate limits on `/auth/otp/send` and `/auth/otp/verify`.
- Move `tokenBlocklist` to Redis.

### PII
- Audit log every read of `financial_statements`, `litigation_records`, OCR extracts.
- Never cache PII-bearing responses in idempotency store.
- Hash/encrypt `id_number`, `date_of_birth`, `address` at rest.

### Webhooks
- Assert webhook secrets at startup in production (H-3).
- Strict format validation before `Buffer.from` (H-4).
- `(provider, providerMessageId)` idempotency cache to reject replays.

### Tenant Isolation
- Subdomain fallback in `tenant-context.middleware.ts:254-262` must resolve slug→tenantId via DB or be removed (M-7).
- Schema-level assertion: every repo helper requires `tenantId` parameter.

---

## Strengths Observed

- **Ledger immutability:** `arrears-service.ts`, `arrears-projection-service.ts` construct new objects — no mutation. New entries reference originals via `relatedEntryId`.
- **Invite-code redeem:** `SELECT FOR UPDATE` + check-then-increment + membership create in a single transaction — correct pattern.
- **JWT algorithm pinning:** HS256 explicitly pinned, prevents alg-confusion.
- **Tenant-scoped repositories:** Every `postgres-*-repository.ts` spot-checked scopes by `tenantId` in WHERE clauses.
- **Webhook signature pattern:** HMAC + `timingSafeEqual` is correct across all three providers.
- **OTP primitives:** SHA-256 hashed storage, TTL expiry, attempt limiting, single-use consumption — correct.

---

## Production Blocker List

Must address before launch:
1. **C-1** — API-key tenant spoofing
2. **C-2** — GePG signature stub in production mode
3. **H-1** — X-Tenant-ID header override
4. **H-2** — ensureTenantIsolation not mounted
5. **H-5** — OtpService production check

Should address within Q2:
6. H-3, H-4, H-6, M-1, M-2, M-3, M-7
