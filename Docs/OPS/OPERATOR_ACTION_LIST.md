# Operator action list — Borjie

**Last updated:** 2026-05-29
**Owner:** Borjie operator (CTO / DevOps / Founder).
**Purpose:** the only things STILL pending production launch that
the engineering brain **cannot** resolve unilaterally: purchases,
contracts, external account creation, regulator credentials,
infrastructure provisioning that requires payment.

Every roadmap item that was previously "deferred to a wave" but
required NO operator action has been CLOSED inline — see
`Docs/AUDIT/ROADMAP_PURGE_2026-05-29.md`.

If an item below has been done, mark it ✅ + add date + commit SHA of
the corresponding wiring change.

---

## OA-001 — Cloudflare Workers AI edge inference (R3)

**Who:** Operator (CTO / Infra)
**What:** Create a Cloudflare account, upgrade to Workers Paid plan
($5/mo + $0.011 per 1000 neurons), enable Workers AI binding.
**Where:** https://dash.cloudflare.com/sign-up → Workers & Pages →
Workers AI → bind models.
**Why blocked from auto-fix:** Cloudflare account creation requires
credit-card + production-domain attachment. The MVP scaffold is
already shipped at `services/edge-inference/wrangler.toml`; only the
deploy step is operator-gated.
**Why scope-justified:** Cost: $5/mo base + per-token billing. We
explicitly do not pay this until pilot SLO data (p90 TTFT > 450ms
on 4G) justifies it.
**Cost:** $5/mo base + ~$0.01 per 1000 tokens of inference
**Time:** 30 min sign-up + 1h deploy walkthrough
**Verification:** `wrangler deploy --env production` from
`services/edge-inference/` succeeds and `borjie-edge-brain` resolves.

---

## OA-002 — GePG production sandbox credentials (R14)

**Who:** Operator (CFO + Finance Lead)
**What:** Apply for GePG (Government Electronic Payment Gateway)
sandbox access from the Tanzania Treasury. Receive `SP`, `SpSysId`,
`PKCS#12 cert (.p12)` + password.
**Where:** https://www.gepg.go.tz/ → "Become a Service Provider"
→ apply. Process is offline (PDF form + bank reference).
**Why blocked from auto-fix:** Credentials are issued by the
Tanzanian Treasury after a 2-4-week bureaucratic review. We cannot
generate or simulate the cert.
**Cost:** TZS 50,000 - 200,000 application fee (varies by tier)
**Time:** 1 day form + 2-4 weeks waiting period
**Once received, set in `.env.production`:**
```
GEPG_SP=Borjie-Mining
GEPG_SP_SYS_ID=<from-letter>
GEPG_CERT_PATH=./secrets/gepg-prod.p12
GEPG_CERT_PASSPHRASE=<from-letter>
```
**Verification:** Run `pnpm -F payments-ledger run test:gepg-roundtrip`
against sandbox URL — round-trip control number issued.

---

## OA-003 — Anthropic production API key (R17)

**Who:** Operator (CTO)
**What:** Sign up for Anthropic API console, generate a production
API key with monthly spend cap.
**Where:** https://console.anthropic.com → Settings → API Keys →
Create Key. Then add to production secret store.
**Why blocked from auto-fix:** API key issuance requires
authenticated payment-method on file. Adapter code in
`packages/ai-copilot/src/adapters/anthropic-doc-chat-llm.ts` is
already written; only the secret is operator-gated.
**Cost:** Pay-as-you-go ($3 / M input tokens, $15 / M output tokens
for Claude Sonnet 4.7). Suggested: $200/mo cap for pilot.
**Time:** 10 min
**Once received, set in `.env.production`:**
```
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MAX_SPEND_USD_MONTHLY=200
```
**Verification:** Boot api-gateway and call
`POST /api/v1/documents/:id/chat` — receives a real LLM response
with `<citations>` tags.

---

## OA-004 — OCR cloud adapter credentials (R21)

**Who:** Operator (CTO)
**What:** Per tenant that opts into cloud OCR, provision either:
- AWS Textract (`AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` +
  region `af-south-1`)
- Google Vision (`GOOGLE_APPLICATION_CREDENTIALS` JSON path)
**Where:**
- AWS: https://console.aws.amazon.com → IAM → users → create
- GCP: https://console.cloud.google.com → IAM → service accounts
  → create key
**Why blocked from auto-fix:** Cloud credentials must be issued
by the cloud account owner. Tesseract dev fallback already works.
**Cost:**
- Textract: $0.0015 per page (form analysis $0.05)
- Vision: $1.50 per 1000 pages
- Tesseract: free (default for low-volume tenants)
**Time:** 20 min IAM setup per tenant
**Verification:** Tenant config `ocr_provider = textract` (or
`vision`) routes a test page through the cloud adapter.

---

## OA-005 — Mobile voice STT via EAS dev build (R25)

**Who:** Operator (CTO / Mobile Lead)
**What:** Sign up for Expo EAS, request native build cycle for
both `apps/workforce-mobile` and `apps/buyer-mobile` with the
Spitch native module bundled. Approve the App Store / Play
internal-distribution submission.
**Where:** https://expo.dev → Create Account → install EAS CLI
→ `eas build --platform all`.
**Why blocked from auto-fix:** EAS builds run in Expo's CI; require
Apple Developer Program account ($99/year) + Google Play console
($25 one-time). Native module enrolment is a paid operator action.
**Cost:** Apple Developer $99/yr + Google Play $25 one-time +
EAS Production tier $99/mo (covers both apps).
**Time:** 4h setup + 1-2 days for first internal build
**Verification:** Worker on mining-supervisor build presses voice
mic in O-M-02 → real Swahili STT path triggers (not placeholder
copy).

---

## OA-006 — Insurance broker partnership contracts (R36)

**Who:** Operator (CEO + Legal)
**What:** Sign at least one TZ-licensed broker partnership
agreement so the C8 insurance-claim chain has a real counterparty.
Requested brokers: AAR Insurance Tanzania, Heritage Insurance, ZIC.
**Where:** Offline — direct negotiation. Broker invitation surface
at `services/api-gateway/src/services/insurance-broker/` ships;
contract is the legal blocker.
**Why blocked from auto-fix:** No code we write generates a signed
broker contract. The end-to-end chain is gated on commercial
agreement.
**Cost:** Broker partnerships typically 0% upfront + 5-10%
commission on settled claims.
**Time:** 6-12 weeks negotiation per broker.
**Verification:** Broker emails `legal@borjie.co.tz` accepting
joinder; we provision broker tenant + complete the C8 chain.

---

## OA-007 — Supabase production tier + region migration

**Who:** Operator (CTO / Infra)
**What:** Upgrade Supabase project from free tier to Pro
($25/mo) for backups + monitoring. If pilot is TZ-only, request
migration from `eu-central-1` (Frankfurt) to `af-south-1`
(Cape Town) for residency compliance.
**Where:** https://supabase.com/dashboard/project/_/settings/general
→ Compute & Add-ons → upgrade. Region migration is a paid
support-ticket request.
**Why blocked from auto-fix:** Compute upgrade requires payment-
method; region migration requires Supabase support agreement.
**Cost:**
- Pro tier: $25/mo
- Region migration: one-off ~$500 (varies by data volume)
- 8 vCPU compute add-on: $110/mo (production tier)
**Time:** Pro upgrade 10 min; region migration 4-6h downtime
+ 2-week scheduling.
**Verification:** `supabase.config.toml` shows `region = af-south-1`;
`pg_dump --version` against prod URL shows af-south-1 endpoint.

---

## OA-008 — Stripe production API keys (for global tenants)

**Who:** Operator (CFO)
**What:** Stripe live mode keys + webhook signing secret.
Currently only test-mode keys are wired.
**Where:** https://dashboard.stripe.com → Developers → API Keys.
Webhook: https://dashboard.stripe.com → Developers → Webhooks
→ create endpoint pointing to
`https://api.borjie.co.tz/api/v1/webhooks/stripe`.
**Why blocked from auto-fix:** Stripe live keys are operator-only;
also requires verified business KYB.
**Cost:** Stripe takes 2.9% + 30¢ per transaction; KYB free.
**Time:** 2 days for KYB review + 5 min key creation post-approval.
**Once received, set in `.env.production`:**
```
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
```
**Verification:** A test PaymentIntent in live mode succeeds.

---

## OA-009 — M-Pesa Daraja production credentials (Safaricom)

**Who:** Operator (CFO)
**What:** Apply for Daraja Production credentials via Safaricom
business portal (currently using sandbox).
**Where:** https://developer.safaricom.co.ke → Production → Apply
**Why blocked from auto-fix:** Daraja production requires Safaricom
business KYC + bank-account-linked till number.
**Cost:** Free credentials; transaction fees per Safaricom tariff.
**Time:** 1-3 weeks Safaricom review.
**Once received, set in `.env.production`:**
```
MPESA_CONSUMER_KEY=<live>
MPESA_CONSUMER_SECRET=<live>
MPESA_PASSKEY=<live>
MPESA_SHORTCODE=<live till>
```
**Verification:** Live STK push to a test phone succeeds.

---

## OA-010 — Sentry DSN production project

**Who:** Operator (CTO / SRE)
**What:** Create a Sentry production project + grab DSN.
**Where:** https://sentry.io → Create Project → choose Node.js +
React Native variants → copy DSN.
**Why blocked from auto-fix:** Sentry account creation + paid tier
($26/mo Team) is operator-only.
**Cost:** Team tier $26/mo (covers ~50K events + 7-day retention)
**Time:** 10 min
**Once received, set in `.env.production`:**
```
SENTRY_DSN_BACKEND=https://...@o0.ingest.sentry.io/0
SENTRY_DSN_MOBILE=https://...@o0.ingest.sentry.io/0
SENTRY_DSN_WEB=https://...@o0.ingest.sentry.io/0
```
**Verification:** Sentry dashboard shows an error from each surface.

---

## OA-011 — PCCB (Tanzania anti-corruption) API access

**Who:** Operator (Legal + Compliance)
**What:** Request API endpoint access from PCCB for automated
sanctions-list lookups (currently hardcoded list snapshot).
**Where:** PCCB Director-General office, Dar es Salaam.
Email: dg@pccb.go.tz
**Why blocked from auto-fix:** PCCB does not publish a self-serve
API. Access is via MoU with the agency.
**Cost:** TZS 250,000 one-off setup + TZS 50,000/mo maintenance
(per PCCB rates).
**Time:** 4-8 weeks MoU negotiation.
**Once received, integrate at**
`packages/compliance-pack/src/providers/pccb-direct.ts`
**Verification:** Live sanctions check returns same result for a
known person as the PDF snapshot.

---

## OA-012 — NEMC inspection-filing API key

**Who:** Operator (Compliance Lead)
**What:** Apply for NEMC (National Environment Management Council)
e-filing API key.
**Where:** https://www.nemc.or.tz → "e-Permits & e-Filing" →
register. Process is partially online.
**Why blocked from auto-fix:** API key issuance requires verified
holder of environmental clearance per project.
**Cost:** TZS 100,000 annual subscription per tenant.
**Time:** 2-4 weeks.
**Once received, set per-tenant:**
```
nemc_api_key = '<per-tenant>'
nemc_facility_id = '<per-facility>'
```
**Verification:** Mock environmental incident filed via API →
NEMC system confirms receipt.

---

## OA-013 — EITI (Extractive Industries Transparency Initiative) slot

**Who:** Operator (Compliance + Investor Relations)
**What:** Request EITI validation slot from TEITI (Tanzania chapter).
Needed for the C5 compliance chain.
**Where:** https://www.eiti.org/countries/tanzania → contact
TEITI secretariat at info@teiti.or.tz
**Why blocked from auto-fix:** EITI validation is an international
peer-review process; no auto-trigger from our system.
**Cost:** Free (TEITI-funded), but ~3 weeks operator time over the
review cycle.
**Time:** Validation runs in 3-year cycles; next TZ slot Q4 2026.
**Verification:** TEITI confirmation letter received; uploaded to
`compliance.eiti_validation_status = passed`.

---

## OA-014 — TMAA (Tanzania Minerals Audit Agency) credentials

**Who:** Operator (CFO + Compliance)
**What:** Register with TMAA portal for monthly mineral production
audits + royalty filing.
**Where:** https://www.tmaa.go.tz → Account Registration → submit
business docs.
**Why blocked from auto-fix:** Account binding requires Mining
Cadastre licence number + government Tax PIN, both per-tenant.
**Cost:** Free registration; royalty filings per mineral tariff.
**Time:** 2-3 weeks review.
**Once received, set per-tenant:**
```
tmaa_portal_id = '<per-tenant>'
tmaa_filer_pin = '<per-officer>'
```
**Verification:** Test royalty filing submitted via API → TMAA
returns confirmation.

---

## OA-015 — OpenAI production key (optional fallback path)

**Who:** Operator (CTO)
**What:** Provision a production OpenAI key for fallback inference
when Anthropic is rate-limited.
**Where:** https://platform.openai.com → API Keys → Create
**Why blocked from auto-fix:** Same as OA-003 — key issuance needs
operator account + spend cap.
**Cost:** Pay-as-you-go ($3/M input, $15/M output for GPT-5
tier). Suggested: $50/mo cap.
**Time:** 10 min
**Once received, set in `.env.production`:**
```
OPENAI_API_KEY=sk-proj-...
OPENAI_MAX_SPEND_USD_MONTHLY=50
```
**Verification:** Fallback path in `multi-llm-brain-adapter` lights
up when ANTHROPIC primary returns 429.

---

## Summary checklist

| OA-# | Title | Cost (USD/mo) | Time | Status |
|------|-------|---------------|------|--------|
| OA-001 | Cloudflare Workers AI | $5+ | 1.5h | pending |
| OA-002 | GePG production sandbox | $30 (one-off) | 2-4 weeks | pending |
| OA-003 | Anthropic production key | $200 cap | 10 min | pending |
| OA-004 | OCR (Textract / Vision) | ~$5/k pages | 20 min/tenant | pending |
| OA-005 | EAS production tier | $99 + $99/yr + $25 one-off | 1-2 days | pending |
| OA-006 | Insurance broker contracts | 5-10% comm. | 6-12 weeks | pending |
| OA-007 | Supabase Pro + region migration | $25 + $500 once | 2 weeks | pending |
| OA-008 | Stripe live keys | per-txn | 2 days | pending |
| OA-009 | M-Pesa Daraja production | per-txn | 1-3 weeks | pending |
| OA-010 | Sentry production DSN | $26 | 10 min | pending |
| OA-011 | PCCB API MoU | TZS 50k/mo | 4-8 weeks | pending |
| OA-012 | NEMC e-filing key | TZS 100k/yr per tenant | 2-4 weeks | pending |
| OA-013 | EITI validation slot | free | 3-week cycle | pending |
| OA-014 | TMAA portal binding | free | 2-3 weeks | pending |
| OA-015 | OpenAI fallback key | $50 cap | 10 min | pending |

**Total monthly cost at full pilot deployment (excluding per-txn):**
$435 + TZS 50k (~$20) = **~$455 / month**.

**Total one-off costs at pilot launch:**
$25 (Google Play) + $500 (Supabase region) + TZS 30k (~$12) = **~$540 one-off**.

---

## Bilingual note

`apps/marketing/src/lib/i18n.ts` and the four web-app catalogs ship
sw/en for end-user copy. This OPS list is internal-only (operator-
team English) per `Docs/CONTRIBUTING.md` §"Internal docs".
