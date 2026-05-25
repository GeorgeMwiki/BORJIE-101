# Security Hardening — Research Notes (2026-05-24)

Companion to `packages/security-hardening`. Captures the design
rationale, 2026 platform state, and the citations that informed each
of the seven subsystems.

The package is deliberately framework-agnostic — every middleware ships
as a small typed function so it composes with Hono, Fastify, Express,
Bun, or Cloudflare Workers without lock-in.

---

## 1. WebAuthn / passkeys

### State of the platform in 2026

By Q1 2026 passkey coverage on the four major OS platforms is effectively
universal: Apple (iCloud Keychain) and Google (Google Password Manager)
have shipped passkey sync since 2022, Microsoft enabled cross-device
passkeys for Microsoft accounts in 2024, and Linux desktops ship via
`libfido2` + browser-native authenticators. The 2026 reality for a
SaaS like BORJIE: every customer's main login device can mint a
synced passkey without the user installing anything.

Library choice: `@simplewebauthn/server` v11+ is the reference TypeScript
implementation, written by Matthew Miller of Cisco Duo. It tracks the
WebAuthn Level 3 spec and ships PR-fast updates for authenticator
metadata quirks. We model it as an OPTIONAL peer-dep so the package
remains installable without it for back-end services that don't need
WebAuthn at all (e.g. internal workers).

### Cross-tenant isolation

Critical detail unique to multi-tenant SaaS: a leaked `credentialId` MUST
NOT be replayable against another tenant. Our `WebAuthnService` tags
every persisted credential with `tenantId` at registration time and
double-checks at authentication time (`credential.tenantId !== user.tenantId`
→ reject before calling the adapter). This is a *structural* defence —
the adapter never sees a mis-tenanted credential.

### Cited sources

1. WebAuthn Level 3 spec — https://www.w3.org/TR/webauthn-3/
2. `@simplewebauthn/server` documentation — https://simplewebauthn.dev/docs/packages/server
3. Apple platform passkeys overview — https://developer.apple.com/passkeys/
4. Google Identity passkey docs — https://developers.google.com/identity/passkeys
5. Microsoft passkey support for MSA + Entra — https://learn.microsoft.com/azure/active-directory/authentication/concept-authentication-passwordless#fido2-security-keys

---

## 2. TOTP / MFA / step-up

We implement RFC 6238 TOTP from scratch (a few hundred lines in
`src/mfa/totp.ts`) rather than pulling a runtime dependency, because:

- RFC 6238 is small and well-specified.
- Every TOTP authenticator in the wild speaks SHA1 + 6-digit + 30s
  step + base32-secret, and we want to control the implementation so we
  can ship the constant-time verifier and the clock-skew window
  ourselves.
- We use Node's `crypto.createHmac` — no native build step, runs on
  Workers and Bun unchanged.

Step-up: for sensitive actions (export tenant data, change owner, add
payout method) we require a fresh MFA challenge within `freshnessMs`
even if the session is already authenticated. This mirrors how Stripe
Connect, AWS IAM, and GitHub gate destructive actions in 2026. The
channel adapter port is intentionally minimal so ops can plug
Africa's Talking SMS, M-Pesa SMS, Twilio Verify, or a custom push
service without touching the orchestrator.

### Cited sources

6. RFC 6238 — TOTP: Time-Based One-Time Password Algorithm — https://www.rfc-editor.org/rfc/rfc6238
7. RFC 4226 — HOTP: An HMAC-Based One-Time Password Algorithm — https://www.rfc-editor.org/rfc/rfc4226
8. Twilio Verify SMS + TOTP docs — https://www.twilio.com/docs/verify

---

## 3. Browser security headers

The presets follow the OWASP Secure Headers Project + Mozilla
Observatory's "A+" baselines. Highlights for 2026:

- **CSP Level 3**: we ship `script-src 'self'` in prod (no `'unsafe-inline'`,
  no `'unsafe-eval'`); CSS allows `'unsafe-inline'` because Tailwind v4
  emits hashed styles that are functionally identical to inline.
- **COEP `require-corp`** + **COOP `same-origin`**: enables
  `crossOriginIsolated` → unlocks `SharedArrayBuffer` for AI inference
  workers and Wasm SIMD.
- **CORP `same-origin`**: opaque responses cannot be embedded by
  other origins unless they explicitly opt in.
- **Permissions-Policy**: denies geolocation/camera/mic/payment/USB by
  default; routes that need them opt in per-route via the route-override
  helper.
- **HSTS**: `max-age=63072000; includeSubDomains; preload` (2 years,
  preload-eligible).

### Cited sources

9. OWASP Secure Headers Project — https://owasp.org/www-project-secure-headers/
10. Mozilla Observatory scoring methodology — https://developer.mozilla.org/docs/Web/Security/Practical_implementation_guides
11. web.dev — Cross-Origin Isolation — https://web.dev/articles/coop-coep

---

## 4. Rate limiting

Three algorithms, one API:

- **Token bucket** — best for bursty traffic with a steady refill rate.
  Capacity controls burst size, refillPerMs the sustained rate.
- **Sliding window (log)** — exact count over a rolling window; higher
  storage cost (one timestamp per request) but no edge-bursts.
- **Fixed window** — cheapest (single counter + expiry); has edge-burst
  issues but acceptable for coarse limits.

The store port exposes ONLY the primitives Redis can do atomically:

- tokenBucket → Lua `EVAL` with compare-and-set
- slidingWindow → `ZADD` + `ZREMRANGEBYSCORE` + `ZCARD`
- fixedWindow → `INCR` + `EXPIRE`

so the Redis adapter (left for ops; the port is the spec) is ~50 lines.

The middleware emits the standard `X-RateLimit-{Limit,Remaining,Reset}`
+ `Retry-After` headers, matching the IETF `draft-ietf-httpapi-ratelimit-headers`
shape.

### Cited sources

12. Cloudflare blog — How rate limiting works — https://blog.cloudflare.com/counting-things-a-lot-of-different-things
13. Stripe API rate limits — https://stripe.com/docs/rate-limits
14. IETF draft RateLimit Headers — https://datatracker.ietf.org/doc/draft-ietf-httpapi-ratelimit-headers/

---

## 5. Anomaly detection

Three composable detectors:

- **Impossible travel** — haversine distance between this attempt and
  the previous one, divided by elapsed time. > 900 km/h (commercial jet
  ceiling) → high score; > 450 km/h → moderate.
- **Unusual hours** — when the user's IANA timezone is known, the local
  hour is compared against the user's recent pattern. Local hours in
  `{0,1,2,3,4}` always carry a mild score.
- **Device drift** — FingerprintJS-style hash. New hash against
  established history → score bump.

The detector returns `{score, factors, recommendation}` and the
recommendation feeds directly into the step-up orchestrator: `step_up`
opens a fresh MFA challenge; `block` refuses the login outright.

Important boundary: we never use the score *alone* to block — the
recommendation is a hint to the auth handler, which can still combine
it with HIBP breach status, stuffing detector verdict, and tenant
policy. The detector is a signal source, not a policy engine.

### Cited sources

15. Stytch documentation — Device fingerprinting + risk scoring — https://stytch.com/docs/fraud
16. Cloudflare Turnstile + bot management — https://blog.cloudflare.com/cloudflare-bot-management-machine-learning-and-more

---

## 6. Credential checks — HIBP + stuffing

**HIBP k-anonymity** (`PwnedPasswords/range/{prefix}`):

1. SHA-1 the password.
2. Send the FIRST 5 hex chars.
3. Response contains every suffix + count for that prefix.
4. Match locally.

HIBP never receives the full hash, so it cannot tie a password to a
user. We expose `check(plaintext)` and `checkSha1(hex)` so callers can
hash in their own runtime if they prefer. Network access is OPTIONAL —
pass a `fetch` shim that returns a canned response for offline tests.

**Credential stuffing**: bots that buy `email:password` lists run them
against many sites. The defence is to detect bursts of *failed* auth
attempts from one (ip, account) within a window. We expose a
detector + an in-memory store; the same store port can be implemented
on Redis for distributed deploys.

A successful auth clears the per-account streak but NOT the per-IP
streak — a bot can hit a single valid combo and still be stuffing the
rest of its list.

### Cited sources

17. HIBP Pwned Passwords API v3 — https://haveibeenpwned.com/API/v3#PwnedPasswords
18. OWASP Credential Stuffing Prevention Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Credential_Stuffing_Prevention_Cheat_Sheet.html

---

## 7. Supply-chain + mTLS — out of scope for this package

The package focuses on application-layer hardening — the surface a Hono
service can opt into in user-space. The transport and supply-chain
layers (Sigstore cosign, SLSA L3 attestations, OSV-Scanner, SPIFFE/SPIRE
mTLS, Istio Ambient) live in `services/` infra and CI configs. The
following sources were consulted for completeness so the package is
*compatible* with those layers (e.g. our `SessionFingerprint` shape has
an optional `tlsFingerprint` field for downstream binding):

19. Sigstore cosign + SLSA L3 — https://www.sigstore.dev/
20. SPIFFE/SPIRE 1.x — https://spiffe.io/docs/

---

## Summary table

| Subsystem            | LOC (src) | Test count |
| -------------------- | ---------:| ----------:|
| WebAuthn             | ~310      | 8          |
| MFA (TOTP + step-up) | ~340      | 18         |
| Headers              | ~150      | 9          |
| Rate limit           | ~250      | 13         |
| Anomaly              | ~150      | 8          |
| Credential checks    | ~200      | 10         |
| Public factory       | ~80       | 2          |
| **Total**            | ~1,480    | **68**     |

Run from `packages/security-hardening/`:

```
pnpm typecheck && pnpm test && pnpm build
```
