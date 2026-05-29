# Borjie operator setup — secrets the operator must supply

**Last updated:** 2026-05-29
**Audience:** human operator provisioning a fresh Borjie environment.

Every variable below MUST be set by an operator before the corresponding
subsystem will run in production. The boot script (`pnpm setup-env`)
auto-generates the random-string secrets but cannot mint these — they
come from an external vendor or a key-management policy decision.

---

## 1. Supabase (auth + storage)

| Variable | Where to get it | Mandatory in |
|----------|----------------|--------------|
| `SUPABASE_URL` | Project Settings → API → Project URL | dev + prod |
| `SUPABASE_SERVICE_ROLE_KEY` | Project Settings → API → service_role | dev + prod |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Project Settings → API → anon | dev + prod |
| `SUPABASE_JWT_SECRET` | Project Settings → API → JWT Settings | prod (optional in dev; JWKS via `SUPABASE_URL` fallback works) |
| `SUPABASE_ACCESS_TOKEN` | https://supabase.com/dashboard/account/tokens — for the `supabase-cli` only | bootstrap only |

Empty `SUPABASE_JWT_SECRET` in dev is **intentional**: the api-gateway
auth middleware falls back to JWKS verification against `SUPABASE_URL`
when no shared HS256 secret is set. See
`services/api-gateway/src/middleware/hono-auth.ts` (lines 104-119).

---

## 2. C2PA content-provenance signer

`packages/content-studio/src/c2pa/signer.ts` REFUSES to fall back to
its dev-stub key when `NODE_ENV === 'production'`. The signer needs:

| Variable | Generate | Notes |
|----------|----------|-------|
| `C2PA_SIGNING_KEY_ID` | operator-named (e.g. `c2pa-prod-2026Q2`) | rotate quarterly |
| `C2PA_SIGNING_KEY_SECRET` | `openssl rand -hex 48` | store in vault, never commit |

---

## 3. Audio-evidence signer (LITFIN audio-logics)

`packages/audio-logics-litfin/src/evidence-chain/signer.ts` REFUSES to
fall back to its dev-stub key when `NODE_ENV === 'production'`. The
signer needs:

| Variable | Generate | Notes |
|----------|----------|-------|
| `AUDIO_EVIDENCE_SIGNING_KEY_ID` | operator-named (e.g. `audio-evidence-prod-2026Q2`) | rotate quarterly |
| `AUDIO_EVIDENCE_SIGNING_KEY_SECRET` | `openssl rand -hex 48` | store in vault, never commit |

The factory in `packages/audio-logics-litfin/src/factory.ts` reads
these via `loadAudioEvidenceSigningKeyFromEnv()` and falls back to the
dev key only when both are unset — which itself is a production-only
throw via the `refuseDevKeyInProduction` guard.

---

## 4. Payment providers (M-Pesa, Stripe, etc.)

| Variable | Where to get it |
|----------|----------------|
| `MPESA_CONSUMER_KEY`, `MPESA_CONSUMER_SECRET`, `MPESA_PASS_KEY` | Safaricom Daraja API portal |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | https://dashboard.stripe.com/apikeys |
| `TIGOPESA_*`, `AIRTELMONEY_*` | respective MNO partner portals |

---

## 5. Auto-generated secrets (covered by `pnpm gen-secrets`)

These are NOT operator-supplied — the generator handles them. Listed
here for completeness so an auditor can see they're rotated, not
hardcoded.

```
JWT_SECRET                    # openssl rand -base64 48
JWT_REFRESH_SECRET            # openssl rand -base64 48
SESSION_HASH_SECRET           # openssl rand -base64 48
ENCRYPTION_MASTER_KEY         # openssl rand -base64 32
CRON_SECRET                   # openssl rand -hex 32
INTERNAL_API_KEY              # openssl rand -hex 32
MCP_API_KEY                   # openssl rand -hex 32
AUDIT_TRAIL_SIGNING_SECRET    # openssl rand -base64 32
COOKIE_SECRET                 # openssl rand -base64 48
```

The pre-2026-05-29 placeholder values (`TODO_BORJIE_GENERATE_*`) have
all been populated in `.env`; see
`Docs/AUDIT/ZERO_HARDCODED_2026-05-29.md` for the audit trail.

---

## 6. Rotation

See `Docs/RUNBOOKS/encryption-at-rest-key-rotation.md` for the
key-rotation runbook covering ENCRYPTION_MASTER_KEY, SESSION_HASH_SECRET,
and the *_PREV overlap window slots.
