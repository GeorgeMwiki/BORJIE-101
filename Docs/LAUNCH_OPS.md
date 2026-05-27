# Borjie Launch Operations Checklist

**Status**: living document — owned jointly by the CEO and the on-call CTO.
**Last Updated**: 2026-05-27
**Audience**: launch operators, on-call engineers, founder, and the
release captain. Every checkbox below should be reviewed at D-30, D-7,
and D-1 before any production launch (pilot, beta, or general
availability).

This file is intentionally action-oriented: each line either passes a
verification step today or is open work. If a checkbox is ambiguous it
is a bug — file an issue and rewrite it as a verifiable assertion.

Local dev setup is automated; see `make dev-bootstrap` and the
`scripts/provision-dev-tenant.ts` + `scripts/seed-demo-data.ts` pair.
Production provisioning is intentionally manual — there is no script
that mutates real infrastructure.

---

## 1. Legal & business

Founder-blocking items. These must be signed and dated before any real
user data enters the system.

- [ ] Terms of Service drafted, reviewed by Tanzanian counsel, and
      published at `https://borjie.co.tz/legal/terms` with an effective
      date no earlier than D-7.
- [ ] Privacy Policy published at `https://borjie.co.tz/legal/privacy`
      covering: PII categories collected, retention windows, data
      subject rights, cross-border transfer disclosures.
- [ ] Data Processing Agreement (DPA) template available for every B2B
      pilot tenant, countersigned by Borjie Inc. and the customer.
- [ ] Acceptable Use Policy published — explicit ban on unlicensed
      mineral trading, money-mule activity, and CSAM uploads.
- [ ] Cookie / tracking notice on every public surface (admin web,
      owner web, marketing) with a working "reject all" path.
- [ ] Brand assets registered: `borjie.co.tz`, `borjie.app`, Apple
      bundle id `co.tz.borjie.workforce`, Google package
      `tz.co.borjie.workforce`.
- [ ] Company incorporation certificate filed in `compliance/`.
- [ ] Business bank account opened (NMB / NBC) — IBAN + SWIFT recorded
      in `infra/secrets/finance.env.encrypted`.
- [ ] M-Pesa Daraja business merchant code provisioned and stored
      encrypted (rotate the test code before flipping to live).
- [ ] Tax registration: TRA TIN issued, VAT certificate filed, tax-
      payment cadence calendar shared with finance.
- [ ] Insurance: cyber-liability + general-liability policies in force,
      coverage limits ≥ USD 1M each.
- [ ] Customer Support Service Level Agreement (SLA) drafted: target
      first response ≤ 4h, target resolution ≤ 24h for P1.
- [ ] Pilot Master Services Agreement signed by each pilot customer,
      stored under `compliance/pilot-msa/`.

---

## 2. Infrastructure

Live infrastructure must be provisioned, not assumed. The local dev
script does NOT touch any of these. Each item below is verified by an
on-call engineer pasting a screenshot into the launch tracker.

- [ ] Production Supabase project created (region: eu-west-1) with
      "compliance" add-on enabled. `SUPABASE_URL` recorded as a secret.
- [ ] Production Postgres tier provisioned: ≥ 8 vCPU / 32 GB RAM /
      500 GB storage with point-in-time recovery enabled and 30-day
      retention. Verify with `aws rds describe-db-instances`.
- [ ] Connection-pooler (PgBouncer or Supabase Pooler) enabled in
      transaction-mode for the gateway and session-mode for migrations.
- [ ] All 183 migrations applied to the production database — run
      `pnpm migration-check` against `DATABASE_URL=<prod>` and confirm
      the audit report is clean.
- [ ] Drizzle migration safety check passes — `pnpm migration-safety`
      returns exit 0 with `--fail-on=fail`.
- [ ] Production Redis (Upstash) provisioned with TLS, daily snapshot,
      and 1 GB memory cap. Verify with `redis-cli --tls -h <host> ping`.
- [ ] Redis is enrolled in the kill-switch fan-out group — confirm the
      `borjie:kill_switch:*` channel exists and is monitored.
- [ ] Anthropic API key (production) issued, rate limit confirmed at
      ≥ 30k req/min, stored in `secrets/anthropic.env.encrypted`.
- [ ] Anthropic spend cap set in the Anthropic console (USD 25k/month
      default; alert at 70%).
- [ ] OpenAI fallback key issued (for graph-sync embeddings).
- [ ] Sentry project provisioned with separate environments `prod`,
      `staging`, `dev`. Source-map upload step wired into the deploy.
- [ ] Sentry alert rules configured: P1 if error volume > 10/min, P2
      if a new fingerprint appears, P3 for performance regressions.
- [ ] OpenTelemetry collector deployed (otel-collector-contrib) routing
      to Honeycomb. The `bootstrapOTel` call in
      `services/api-gateway/src/index.ts` runs before any other module.
- [ ] Domain `borjie.co.tz` registered, DNS managed in Route53, MX
      records pointing at Google Workspace.
- [ ] Wildcard TLS certificate issued by ACM, attached to ALB. Auto-
      renew confirmed.
- [ ] Status page provisioned at `https://status.borjie.co.tz` (Atlassian
      Statuspage or Instatus). Probes pointing at `/api/v1/health` for
      each region.
- [ ] CDN (CloudFront) configured for static assets; cache-control
      header verified for `/_next/static/*`.
- [ ] S3 bucket `borjie-prod-evidence` created with KMS-CMK encryption,
      bucket policy denying public access, lifecycle rule for
      transition to Glacier after 90 days.
- [ ] Backups: nightly logical dump of Postgres to S3, retention 35
      days. Restore drill executed at least once, drill report filed.
- [ ] Disaster Recovery: documented RTO ≤ 4h, RPO ≤ 15min. Drill date
      logged in `Docs/DISASTER_RECOVERY_DRILLS.md`.
- [ ] Production environment secrets rotated within the last 90 days
      (script: `scripts/rotate-keys.mjs`).

---

## 3. Payment gateways

Two providers — M-Pesa Daraja and Stripe — must both be promoted from
sandbox to live with rotated keys.

- [ ] M-Pesa Daraja sandbox tests pass for `STK-Push`, `B2C`, and
      `Transaction Status` against the staging shortcode.
- [ ] M-Pesa Daraja live shortcode issued by Safaricom Tanzania,
      consumer key + secret stored encrypted.
- [ ] M-Pesa Daraja webhook URL `https://api.borjie.co.tz/webhooks/mpesa`
      registered and reachable from Safaricom's static IPs.
- [ ] M-Pesa webhook signature verification verified end-to-end (test
      payload signed → consumer accepts; tampered payload → rejected).
- [ ] M-Pesa idempotency: replay a webhook payload twice and confirm
      only one ledger entry is posted (via `services/payments-ledger`).
- [ ] Stripe live API keys issued, restricted to the production
      account, stored in `secrets/stripe.env.encrypted`.
- [ ] Stripe webhook endpoint `https://api.borjie.co.tz/webhooks/stripe`
      configured with a 64-byte signing secret; signature verification
      validated.
- [ ] Stripe customer portal enabled with the production publishable
      key embedded in `apps/owner-web`.
- [ ] PCI: Stripe SAQ-A questionnaire completed and filed in
      `compliance/pci/`.
- [ ] Refund flow tested end-to-end against Stripe live (small
      amount), and against M-Pesa B2C reversal sandbox.
- [ ] FX rate refresh job (`pnpm refresh-fx-rates`) runs hourly via
      cron and persists to `currency_rates`.
- [ ] Multi-currency invariant verified: posting a non-TZS contract
      domestically returns the `currency_cliff` 422 (per the post
      27-Mar-2026 USD-cliff remediation mode).

---

## 4. Mobile app stores

Both apps (`apps/workforce-mobile` and `apps/buyer-mobile`) ship via EAS
build to the App Store and Play Store. Apple's review can take 2–7
business days; submit no later than D-14.

- [ ] Apple Developer Program enrolled under "Borjie Inc.", D-U-N-S
      number issued, contact email monitored.
- [ ] Google Play Console developer account created, payment profile
      complete, identity verified.
- [ ] EAS Build configured (`apps/workforce-mobile/eas.json` and
      `apps/buyer-mobile/eas.json`) — preview + production profiles
      compile cleanly via `eas build --profile production`.
- [ ] App icons + splash screens exported at every required density
      (1x/2x/3x for iOS, ldpi..xxxhdpi for Android).
- [ ] App Store screenshots prepared at 6.7" (iPhone Pro Max) and 12.9"
      (iPad Pro) sizes — five screenshots per locale (sw + en).
- [ ] Play Store screenshots prepared at phone + 7" tablet + 10" tablet.
- [ ] App Store privacy nutrition labels filled in (location, device
      id, name, phone, email, photos).
- [ ] Play Store Data Safety section completed; privacy policy URL
      points at the published Privacy Policy from §1.
- [ ] Permissions justification recorded for every native permission
      (camera, location, push, biometric). Reviewed by counsel.
- [ ] In-app purchase / billing configured if applicable, or app
      classified as `Free` and external-payment exemption requested.
- [ ] Test flight / internal testing track distributed to ≥ 10 pilot
      users and signed-off in writing.
- [ ] Crashlytics / Sentry React Native wired and verified to receive a
      forced test crash from the production build.
- [ ] Build versioning rule documented: every EAS submit bumps
      `expoConfig.version` AND `expoConfig.ios.buildNumber` AND
      `expoConfig.android.versionCode`.

---

## 5. Communication providers

Messages must reach miners and buyers reliably across SMS, voice, and
email even when mobile data is patchy.

- [ ] Twilio account upgraded to a paid plan with a Tanzania short
      code provisioned and a verified sender id `BORJIE`.
- [ ] Africa's Talking fallback configured with a 14-day failover
      window; route table verifies Twilio first, AT on timeout.
- [ ] Twilio webhook for delivery receipts wired at
      `/api/v1/notifications/webhooks/twilio`; signature validated.
- [ ] SendGrid (or Postmark) account verified for `noreply@borjie.co.tz`
      with SPF + DKIM + DMARC records.
- [ ] Transactional email templates (welcome, OTP, password-reset,
      bid-accepted, invoice-issued) live in SendGrid and reference-
      tested against staging.
- [ ] WhatsApp Business API account approved with a verified profile
      and three message templates (welcome, OTP, escalation).
- [ ] Notification preferences default safely: SMS off, email off,
      WhatsApp opt-in only. Verified in `notification_preferences`.
- [ ] Provider failover drill executed: disable Twilio mid-test and
      confirm AT takes over without dropped messages.

---

## 6. Customer support

Day-1 customer success requires real humans on real channels.

- [ ] Support inbox `support@borjie.co.tz` created and monitored 7/7
      08:00–20:00 EAT; out-of-hours auto-responder mentions SLA.
- [ ] Support WhatsApp number `+255 7XX XXX XXX` published on the
      website and inside the apps; routed to the support queue.
- [ ] Help-center articles authored for: signing in, OTP recovery,
      M-Pesa errors, biometric enrolment, buyer-bid lifecycle. Each
      article translated to Swahili.
- [ ] PagerDuty (or Opsgenie) configured with primary + secondary
      on-call schedules for the launch week. Escalation policy filed.
- [ ] Founder phone tree printed and pinned in the war-room: CEO →
      CTO → support lead → counsel.
- [ ] Internal #launch-warroom Slack channel created with bridges to
      Sentry, Statuspage, and the on-call rotation.
- [ ] Public status page subscribed to by every pilot customer
      (per-customer email list captured).
- [ ] War-room runbook published at `Docs/RUNBOOK_LAUNCH_WAR_ROOM.md`
      with on-call hand-off times and known-issue links.

---

## 7. Pre-launch verification (D-7)

Smoke and load tests must pass against the production stack inside the
final week. Each line maps to a make / pnpm target so the work is
mechanical.

- [ ] `pnpm migration-check` against the production `DATABASE_URL`
      returns no failures.
- [ ] `pnpm test:e2e:local` passes end-to-end against the staging
      stack with the production-shaped seed.
- [ ] `pnpm load-test` (or `scripts/load-test-suite.sh`) sustains
      500 RPS against `/api/v1/health` for 5 minutes with p95 < 250ms.
- [ ] Anthropic kill-switch tripped manually via `feature_flags`,
      confirmed to fail-closed (no LLM call surfaces), then reset.
- [ ] Sentry receives a forced error from `apps/owner-web`,
      `apps/admin-web`, and the gateway — all three resolve to the
      production environment.
- [ ] OpenTelemetry: a manual trace from owner-web → gateway →
      junior-ai appears in Honeycomb within 30 seconds.
- [ ] Backups verified: trigger a manual snapshot, restore it into a
      throwaway database, confirm `borjie-restore-smoke-test.sh` exits
      0.
- [ ] Webhook idempotency replay test: replay the last 10 production
      webhooks against staging and confirm zero duplicate ledger
      entries (per the "at-least-once" invariant in `CLAUDE.md`).
- [ ] Mobile builds smoke-tested on a real device per platform — open,
      log in, place a bid, confirm push notification arrives.
- [ ] Privacy: a manual DSAR export request executes end-to-end via
      `scripts/rtbf-verification.mjs` and produces a downloadable
      bundle.

---

## 8. Day-1 readiness

Final-hours checklist. Every item is owned by a named human; nothing
gets ticked by Slack reaction alone.

- [ ] CEO + CTO confirmed on-call 24h before the announcement, with
      flight-mode reminders set on their phones.
- [ ] Support team briefed on the 10 most likely D-1 tickets and the
      stock responses for each, in both Swahili and English.
- [ ] Statuspage initial post drafted ("Borjie is now live in
      Tanzania") with a fallback variant for partial degradation.
- [ ] Refund flow rehearsed end-to-end with the finance team —
      timing, who-clicks-what, audit-trail entry verified.
- [ ] Press kit ready (brand assets, fact sheet, two CEO quotes,
      contact details) accessible from `https://borjie.co.tz/press`.
- [ ] Marketing site (`apps/owner-web` marketing routes) reviewed for
      typos and broken links; lighthouse score ≥ 90 on mobile.
- [ ] Pilot tenants notified by direct message 24h ahead, given the
      support number and an asynchronous escalation path.
- [ ] Roll-back plan documented: a single command to flip the gateway
      to "maintenance" mode plus an emergency contact at Supabase.
- [ ] Database write traffic rate-limited to 100 RPS per tenant at the
      gateway; per-tenant ceilings recorded in `policy_rollouts`.
- [ ] Final dry-run of the announcement post-launch ritual: post-
      mortem template open, war-room transcript recording on, retro
      scheduled for D+3.

---

## Local dev shortcut

For day-to-day engineering — these targets do NOT touch production.

```bash
# Provision a dev tenant + owner (idempotent).
make provision-dev TENANT_NAME="Acme Mining" EMAIL=owner@acme.test PHONE=+255700000000

# Seed realistic mining data into that tenant (3 sites, 15 workers,
# 10 ore parcels, 3 buyers with bids, 2 incidents, 5 documents).
make seed-demo PHONE=+255700000000

# One-shot bootstrap: provision + seed.
make dev-bootstrap TENANT_NAME="Acme Mining" EMAIL=owner@acme.test PHONE=+255700000000
```

The underlying scripts (`scripts/provision-dev-tenant.ts` +
`scripts/seed-demo-data.ts`) hit the public `/api/v1/orgs/signup` and
the mining endpoints under `/api/v1/mining/*`, so dev exercises the
exact same production code paths.
