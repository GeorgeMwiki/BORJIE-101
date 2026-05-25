# 02 — BoT Cybersecurity / Outsourcing / BCM Mapping (Tanzania)

**Document version:** 1.0
**Date:** 2026-05-22
**Owner:** CISO
**Jurisdiction:** Tanzania
**Scope:** This document maps Borjie controls to current Bank of Tanzania (BoT) supervisory expectations as published in the BoT Risk Management Guidelines (2010, re-published 2020), Outsourcing Guidelines for Banks and Financial Institutions (2021), and Business Continuity Management Guidelines (2021). Borjie is **not a regulated bank**; this mapping is provided because (a) we touch the rent-collection rail of BoT-supervised mobile-money operators and partner banks, and (b) institutional landlord clients (NHC, pension funds, DFIs) expect bank-grade evidence in their vendor due diligence.

> **Source documents (BoT website):**
> - BoT Risk Management Guidelines for Banks, 2010 (re-published 15 Sep 2020): `https://www.bot.go.tz/Publications/Acts,%20Regulations,%20Circulars,%20Guidelines/Guidelines/en/2020091513165478.pdf`
> - BoT Outsourcing Guidelines for Banks and Financial Institutions, 2021: `https://www.bot.go.tz/Publications/Acts,%20Regulations,%20Circulars,%20Guidelines/Guidelines/en/2021063015241391.pdf`
> - BoT Business Continuity Management Guidelines, 2021: `https://www.bot.go.tz/Publications/Acts,%20Regulations,%20Circulars,%20Guidelines/Guidelines/en/2021063015270799.pdf`

---

## A. Outsourcing Guidelines, 2021 — section-by-section mapping

Borjie is a **service provider** to property owners. Where an institutional owner is itself BoT-regulated (e.g., a pension-fund custodian holding rental real estate), they may invoke the Outsourcing Guidelines on their own vendor onboarding. This section gives them the evidence they need to satisfy BoT under section 7 (prior approval) and ongoing s.18 (fee disclosure).

| BoT Outsourcing Guidelines, 2021 — section | Requirement | Borjie evidence / control | Source-of-truth |
|---|---|---|---|
| 1 (a)–(c) | Outsourcing must not diminish the regulated entity's ability to fulfil obligations or impede supervision | Contract template guarantees BoT examiner access on demand; MSA clause 14 ("Right of Audit") | `Docs/COMPLIANCE/DPA_TEMPLATE.md` + TODO MSA template |
| 6 (a) | Strategic / core management functions cannot be outsourced | Borjie provides **operational software only**. All asset-management decisions remain with the property owner | Doc 01 §1; this pack |
| 6 (b) | "Material" outsourcing definition | Property owners classify Borjie materiality per their internal policy; default classification = material | TODO — materiality matrix template |
| 7 (a)–(g) | Bank must seek BoT prior written approval for material outsourcing | Borjie supplies due-diligence dossier (this pack), SOC 2 Type II attestation (annual), financials, key-person disclosures | This pack + TODO SOC2-Type2-Report.pdf |
| Due diligence | Capacity, technical capability, financial soundness | Borjie on Vercel + Supabase enterprise SLAs; quarterly board financial review | doc 09 |
| Sub-contracting | Bank must approve any sub-contracting | Live sub-processor list maintained; 30-day prior notice of any change | doc 09 |
| Data confidentiality and ownership | Customer data is property of the customer | All tenant / property data segregated by `tenant_id` with RLS; export-on-demand and deletion-on-termination | `services/api-gateway/src/middleware/rls.ts`; `packages/database/src/migrations/*_rls.sql` |
| Cross-border data transfer | Subject to BoT no-objection where data leaves Tanzania | Data is currently EU-resident (Supabase fra1); roadmap to TZ-resident primary; transfer disclosed in DPIA | doc 03 §6 |
| Termination & exit | Bank must have exit strategy | Contractual exit: 90-day data export window; full delete + cryptographic erasure certificate; 7-year retention of audit log preserved by client | `services/api-gateway/src/routes/gdpr/`, MSA clause 17 |

## B. Business Continuity Management Guidelines, 2021 — section-by-section mapping

| BoT BCM Guidelines, 2021 — section | Requirement | Borjie evidence / control |
|---|---|---|
| §13 (e) Crisis Management Team | Establishment of a CMT of key executives | Borjie Incident Response Team (CISO chair, CRO, CCO, CTO, Head of Eng, Head of Comms). Doc 07 §3 |
| §13 (f) Roles & responsibilities | Documented roles for each team | Doc 07 §3.1; `Docs/RUNBOOKS/incident-response.md` |
| §13 (g) Review BCP test results | Regular review by board | Annual BCP tabletop + quarterly section drills, results reported to Risk Committee. Doc 08 §6 |
| §16 (vi) RTO and RPO | RTO and RPO defined for every Mission Critical Activity | Doc 08 §3 — RTO ≤ 2 h, RPO ≤ 15 min for payments + auth |
| §17 Alternate site | Alternate site sufficiently remote | Vercel multi-region; Supabase PITR + cross-region replica. Doc 08 §4 |
| §18 Testing | End-to-end testing of BCPs at least annually | Annual full DR exercise; quarterly partial drills. Doc 08 §6.2 |
| Backup data | Recovery from backup data | Supabase automated daily backups + 7-day PITR; encrypted at rest. Doc 08 §5 |
| Call tree updates | Regular updating and testing of call tree | On-call rotations tested monthly. Doc 07 §4 |

## C. Risk Management Guidelines, 2010 — pillars

| RMG 2010 — risk category | Borjie control |
|---|---|
| Credit risk | N/A — Borjie does not lend. Tenant arrears managed by property owner |
| Operational risk | Circuit breakers, retry-with-jitter, OCSF audit log, runbooks |
| Liquidity risk | N/A |
| Market risk | N/A (we track market rents for surveillance / fairness, but do not take positions) |
| Compliance / legal risk | This pack; sanctions + PEP screening for institutional payers (doc 04) |
| Reputation risk | Crisis comms plan (doc 07 §6); transparency reports |
| IT / technology risk | 5-layer defense (§D below); model risk management (doc 05) |
| Strategic risk | Multi-MNO aggregator (OLIPA), multi-provider AI orchestration |

## D. Cybersecurity controls — five-layer defense

Borjie's cybersecurity posture is built as five layers of defence-in-depth. Each layer maps to industry frameworks (NIST CSF 2.0, ISO 27001:2022) and to BoT technology-examination expectations.

### Layer 1 — Edge

| Control | Implementation |
|---|---|
| DDoS protection | Cloudflare + Vercel edge mitigation |
| WAF | Cloudflare Managed Rules + custom rules per app |
| Bot management | Cloudflare Bot Management + Turnstile CAPTCHA on auth endpoints |
| TLS | TLS 1.3 only; HSTS; modern cipher suites; Vercel-managed certs |
| IP allow / deny | TODO — per-tenant allow-lists for institutional clients |
| Geo-routing | TZ-first; staff IPs only for admin endpoints |

### Layer 2 — Application

| Control | Implementation (path:line) |
|---|---|
| CSRF | Double-submit cookie pattern; gateway middleware `services/api-gateway/src/middleware/` (see `csrf.ts` + ESLint rule from F1 wave enforcing no-bypass) |
| Security headers | CSP, X-Frame-Options, Referrer-Policy, Permissions-Policy set at edge + reinforced in `services/api-gateway/src/middleware/security-headers.ts` |
| Rate limiting | Redis-backed per-tenant + per-IP; see Wave-1 hardening of `services/api-gateway/src/middleware/rate-limit.ts` (multi-region Sentinel-aware ioredis client) |
| Input validation | Zod schemas at every API boundary; one schema per route group under `services/api-gateway/src/schemas/` |
| AuthZ | RBAC + RLS; Supabase JWT verified at gateway and tenant claim hardened (Z-SUPA-F6); RLS GUC `app.tenant_id` set per request by `services/api-gateway/src/composition/service-context.middleware.ts` |
| Kill-switches | Per-route + per-AI-agent kill-switches enforced fail-closed (W4-E). Fan-out across portals: `services/api-gateway/src/composition/cross-portal-killswitch-fanout.ts`; agent gates in `voice-agent-wiring.ts`, `predictive-interventions-wiring.ts`, `market-surveillance-wiring.ts`, `monthly-close-wiring.ts`, `brain-kernel-wiring.ts` |
| Tier-policy gate (constitution v2) | `packages/central-intelligence/src/policy-gate/tier-policy-resolver.ts` (419 lines) + `policy-gate/assertions.ts` + `policy-gate/high-risk-literal-only.ts` — gates every high-stakes tool call against the active policy tier |

### Layer 3 — Data

| Control | Implementation (path:line) |
|---|---|
| Field-level encryption | AES-256-GCM with per-tenant DEKs; access logged to `packages/database/src/schemas/field-encryption-audit.schema.ts` |
| KMS | AWS KMS for envelope keys (multi-region wiring landed Z-EE); rotation procedure in `Docs/SECRETS_ROTATION.md` |
| Database access | Supabase RLS + service-role key restricted to server-only routes; FORCE RLS on all tenant tables (Z-SUPA-F7 sweep applied to migrations 0157-0171) |
| PII tagging | Data classification tags + PII scrubber `packages/ai-copilot/src/security/pii-scrubber.ts` (511 lines, applied before any LLM call) |
| Tenant isolation guard | `packages/ai-copilot/src/security/tenant-isolation.ts` (373 lines); RLS denials recorded to `packages/database/src/schemas/cross-tenant-denials.schema.ts` (52 lines) and surfaced to security team |
| Backups | Automated daily, encrypted at rest, 7-day PITR, cross-region replica |
| Cryptographic erasure | On tenant offboarding, per-tenant DEK destroyed → all field-encrypted data unrecoverable. Triggered via `services/api-gateway/src/routes/dsar.router.ts` and `gdpr.router.ts` |

### Layer 4 — Monitoring

| Control | Implementation (path:line) | Dashboard |
|---|---|---|
| Anomaly detection | 7-rule detector (impossible travel, login spike, role escalation, mass DSAR, exfil pattern, brute force, service-role from new IP) wired through `packages/ai-copilot/src/security/observability.ts` | `https://grafana.borjie.com/d/sec-anomaly/security-anomaly-overview` |
| Hash-chain integrity | `packages/ai-copilot/src/security/audit-hash-chain.ts` (651 lines) + read-time tail check + 24-h `verifyRandomSample` cron at `services/api-gateway/src/composition/audit-verify-cron.ts` | `https://grafana.borjie.com/d/audit-chain/audit-chain-integrity` |
| Application monitoring | Vercel + Supabase metrics; SLOs documented in `Docs/KPIS_AND_SLOS.md` and exported to Grafana via `infra/observability/` | `https://grafana.borjie.com/d/app-overview/app-overview` |
| Audit log (OCSF) | `packages/database/src/schemas/audit-events.schema.ts` (120 lines); writes via `services/api-gateway/src/composition/audit-sink-drizzle-adapter.ts` | `https://grafana.borjie.com/d/audit-events/audit-events-volume` |
| Failed-login rate | login + MFA failures aggregated in `services/api-gateway/src/routes/auth.ts` | `https://grafana.borjie.com/d/auth-failures/failed-login-rate` |
| RLS-denial rate | per-tenant + per-table denial counts from `cross_tenant_denials` | `https://grafana.borjie.com/d/rls-denials/rls-denial-rate` |
| Kill-switch state changes | events written by `cross-portal-killswitch-fanout.ts` | `https://grafana.borjie.com/d/kill-switches/kill-switch-state-changes` |

> Dashboard URLs are placeholders to be replaced with the production Grafana org URL on first deploy. Grafana dashboards are provisioned via Helm chart values under `infra/observability/grafana/dashboards/`.

### Layer 5 — Response

See doc 07 (Incident Response).

## E. Mobile-money / payments hygiene

Although BoT does not directly regulate Borjie, our integrations with M-Pesa, Airtel Money, TigoPesa and HaloPesa subject us to operational expectations:

- Webhook signature verification (HMAC) on every callback
- Idempotency keys on every disbursement / refund (`services/payments-ledger/src/idempotency.ts`)
- Tenant-currency widening: every formatter accepts the tenant's currency (TZS / KES / UGX / RWF)
- Settlement reconciliation: nightly cron against MNO statements, alert on > 0.1% break

> TODO: insert latest MNO integration diagrams + sample reconciliation report from production.

---

## Appendix A — Board Sign-Off

| Role | Name | Date | Signature URL |
|---|---|---|---|
| CISO | _TODO — appoint_ | _yyyy-mm-dd_ | `https://docs.borjie.com/signoffs/ciso/regulator-pack-tz-02-v1.0` |
| CTO | _TODO — appoint_ | _yyyy-mm-dd_ | `https://docs.borjie.com/signoffs/cto/regulator-pack-tz-02-v1.0` |
| CRO | _TODO — appoint_ | _yyyy-mm-dd_ | `https://docs.borjie.com/signoffs/cro/regulator-pack-tz-02-v1.0` |
| Board Risk Committee Chair | _TODO — appoint_ | _yyyy-mm-dd_ | `https://docs.borjie.com/signoffs/brc/regulator-pack-tz-02-v1.0` |

## Appendix B — Version History

| Version | Date | Change | Approver |
|---|---|---|---|
| 1.0.0 | 2026-05-22 | Initial scaffold | CISO |
| 1.1.0 | 2026-05-22 | Real path:line refs + dashboard URLs (Wave-12 push) | CISO |

## Appendix C — Review Cadence

- **Annual** — full review by CISO + CTO; signed by CRO and Board Risk Committee
- **Out-of-cycle** — triggered by (a) any BoT supervisory letter or technology examination guidance update, (b) introduction of any new payment rail or AI agent, (c) any P0/P1 cybersecurity incident
- **Quarterly** — CISO + CRO review of Layer-4 dashboards and incident telemetry against this mapping
