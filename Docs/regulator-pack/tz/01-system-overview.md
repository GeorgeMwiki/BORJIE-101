# 01 — System Overview (Tanzania)

**Document version:** 1.0
**Date:** 2026-05-22
**Owner:** Chief Risk Officer (CRO) + Chief Compliance Officer (CCO)
**Jurisdiction:** United Republic of Tanzania (mainland + Zanzibar)

---

## 1. What Borjie is

Borjie is a multi-tenant, AI-native property-management platform serving residential and commercial landlords, estate management companies, tenants and back-office operations teams across East Africa. The platform digitises rent collection, lease lifecycle, maintenance dispatch, tenant communication and owner reporting, with an AI "Brain" (kernel) layered on top of an operational backbone.

The platform is **operational software, not a financial institution**: Borjie does not hold deposits, does not lend, does not provide investment advice, and is not a payment service provider in its own name. Rent payments flow through licensed mobile-money operators and banks (M-Pesa Tanzania, Airtel Money, TigoPesa, HaloPesa, GePG); Borjie is the reconciliation layer and tenant ledger of record.

### 1.1 Core capabilities — source-of-truth in Borjie monorepo

The platform is a TypeScript modular monolith. Every capability below cites a real path that examiners may open during a review. Line ranges are accurate at time of writing (regulator-pack v1.0); the `git blame` of `packages/database/src/schemas/audit-events.schema.ts` confirms drift detection so the table can be re-anchored at the start of every annual review cycle.

| Capability | Source-of-truth path:line (Borjie monorepo) |
|---|---|
| Property / unit / lease / tenant / payment master data (drizzle schemas, RLS-scoped) | `packages/database/src/schemas/identity.schema.ts`, `payment.schema.ts`, `tenant-finance.schema.ts`, `occupancy.schema.ts`, `ledger.schema.ts` |
| Rent collection via M-Pesa STK Push, Airtel, TigoPesa, HaloPesa, GePG | `services/payments-ledger/src/` (full service); routes at `services/api-gateway/src/routes/gepg.router.ts`; webhook receivers in `services/webhooks/src/` |
| Maintenance request dispatch + vendor coordination | `apps/estate-manager-app/src/` + maintenance triage agent at `packages/central-intelligence/src/maintenance-triage/triage-agent.ts` |
| Tenant communication (in-app, WhatsApp, SMS, voice) | `services/notifications/src/` + dispatcher adapter at `services/api-gateway/src/composition/notification-dispatcher-adapter.ts`; voice persona at `packages/ai-copilot/src/voice-persona-dna/` |
| Owner / investor portfolio reporting | `apps/owner-portal/`, `services/reports/src/` (incl. tax formatters `services/reports/src/compliance/tz-tra-formatter.ts`, `ke-kra-formatter.ts`) |
| AI kernel + voice agent + wired AI-native agents | Kernel: `packages/central-intelligence/src/kernel/` (719-line LATS search at `orchestrator/lats-search.ts`); wirings: `services/api-gateway/src/composition/brain-kernel-wiring.ts`, `voice-agent-wiring.ts`, `market-surveillance-wiring.ts`, `predictive-interventions-wiring.ts` |
| Audit chain + RLS + field-level encryption | `packages/ai-copilot/src/security/audit-hash-chain.ts` (651 lines); `packages/ai-copilot/src/security/tenant-isolation.ts` (373 lines); RLS GUC wired by `services/api-gateway/src/composition/service-context.middleware.ts`; field encryption keys recorded in `packages/database/src/schemas/field-encryption-audit.schema.ts` |
| Kill-switch fan-out across services | `services/api-gateway/src/composition/cross-portal-killswitch-fanout.ts`; per-agent kill-switches in each `*-wiring.ts` |
| Policy tier resolver (constitution v2 — gates high-risk tools) | `packages/central-intelligence/src/policy-gate/tier-policy-resolver.ts` (419 lines) + `policy-gate/assertions.ts` + `policy-gate/high-risk-literal-only.ts` |
| Reflexion + 4-pass sleep consolidation | `packages/central-intelligence/src/kernel/reflexion/` (recorder, writer, retriever, loader) + nightly sleep at `kernel/reflexion/sleep/nightly-sleep.ts` (230 lines) + 4 pass files |
| Sovereign action ledger (immutable record of consequential agent actions) | `packages/database/src/schemas/sovereign-action-ledger.schema.ts` (98 lines); verify cron at `services/api-gateway/src/composition/sovereign-ledger-verify-cron.ts` |
| Cross-tenant denial telemetry (RLS denial events) | `packages/database/src/schemas/cross-tenant-denials.schema.ts` (52 lines) |

## 2. Jurisdictions

Primary jurisdiction is **United Republic of Tanzania**. The platform is also operational in / planned for other East African Community markets.

| Jurisdiction | Status | Primary regulator(s) | Key statute(s) |
|---|---|---|---|
| Tanzania (mainland + Zanzibar) | Live | Bank of Tanzania (BoT — payments hygiene), Tanzania Revenue Authority (TRA — landlord tax), NIDA (identity), Personal Data Protection Commission (PDPC), TCRA (telecom) | Personal Data Protection Act 2022 (Act No. 11 of 2022); Land (Lease) Regulations; Tax Administration Act; Electronic Transactions Act 2015 |
| Kenya | Live (parallel pack) | Central Bank of Kenya (CBK), Kenya Revenue Authority (KRA), ODPC, Capital Markets Authority (CMA — only for REITs / fund-managed portfolios) | Data Protection Act 2019; Landlord & Tenant Acts; ICT Act |
| Uganda | Roadmap | Bank of Uganda, URA, NITA-U | Data Protection and Privacy Act 2019 |
| Rwanda | Roadmap | NBR, RRA | Law on Protection of Personal Data 2021 |

The default deployment for TZ tenants is **Africa-resident where possible**: Supabase Frankfurt (`fra1`) primary with cross-region replicas, transitioning to a Tanzania-resident primary when a SOC-2-attested local provider is available. Cross-border transfers are documented vendor-by-vendor in `09-vendors-and-subprocessors.md`.

## 3. Risk Taxonomy

Borjie maintains a single risk register, reviewed quarterly by the Risk & Audit Committee. The categories below are super-set of BoT supervisory categories adapted for a property-tech SaaS.

| Category | Sub-categories | Mitigating controls |
|---|---|---|
| **Tenant-identity risk** | Fraudulent tenant onboarding, ID-document forgery, synthetic identities | NIDA lookup, ID-document OCR + liveness (Smile ID), reference checks |
| **Payments / settlement risk** | Failed STK callback, mis-reconciled rent, double-charge, refund fraud | Idempotent webhooks (`services/payments-ledger/`), reconciliation outbox, four-eyes on refunds |
| **Operational risk** | Outage, vendor failure, human error, on-call gap | BCM/DR (doc 08), circuit breakers, runbooks (`Docs/RUNBOOKS/`) |
| **Cybersecurity / IT risk** | Account takeover, data breach, ransomware, supply-chain compromise | 5-layer defense (doc 02), anomaly detection, hash-chain audit (doc 10) |
| **Privacy / data-protection risk** | Unlawful processing, mishandled DSAR, cross-border transfer | DPIA programme (doc 03), DSAR endpoints (`services/api-gateway/src/routes/gdpr/`), field-level AES-256-GCM |
| **Compliance / legal risk** | Landlord-tax non-disclosure, AML on rent flows, lease-law non-compliance | TRA reporting feeds, AML controls (doc 04), tenancy-law jurisdiction matrix |
| **Conduct / fair-treatment risk** | Discriminatory tenant screening, opaque eviction triggers, rent-pricing bias | Fairness controls (doc 06), human-in-the-loop on eviction-related actions |
| **AI / model risk** | Hallucinated voice-agent answer, drifted pricing model, biased maintenance dispatch | Model Risk Management (doc 05), model cards, kill-switches (`packages/ai-copilot/src/safety/`) |
| **Reputational risk** | Tenant-rights advocacy backlash, regulator action, viral incident | Crisis comms plan (doc 07 §6), media monitoring, transparency reports |
| **Strategic risk** | MNO lock-in, regulatory change, market shift | Multi-MNO aggregator (OLIPA), multi-provider AI orchestration, open-source-first connectors |

## 4. Governance Structure

```
                              ┌─────────────────────────┐
                              │     Board of Directors  │
                              └──────────┬──────────────┘
            ┌─────────────────┬──────────┴─────────┬──────────────────┐
            │                 │                    │                  │
   Risk & Audit Cmte    Tech Cmte         Compliance Cmte       Remuneration
            │                 │                    │
   ┌────────┴─────────┐  ┌────┴────┐    ┌──────────┴────────┐
   │                  │  │         │    │                   │
   CRO              CCO  CTO      CISO  DPO              MLRO
```

| Role | Holder | Reports to | Independence |
|---|---|---|---|
| Chief Risk Officer (CRO) | TODO — appoint | Board Risk Committee | Independent of revenue lines |
| Chief Compliance Officer (CCO) | TODO — appoint | Board Compliance Committee | Independent of product |
| Chief Information Security Officer (CISO) | TODO — appoint | CTO + dotted line to Risk Cmte | Independent of dev teams |
| Data Protection Officer (DPO) | TODO — appoint | Board (direct) | PDPA Section 30 compliant |
| Money Laundering Reporting Officer (MLRO) | TODO — appoint | CCO + dotted line to FIU | Senior management level |
| Model Risk Manager | TODO — appoint | CRO | Independent of model developers |

Four-eyes principle enforced for: refund approvals over TZS 500,000, eviction-related communications, encryption-key rotation, model promotion to production, and any kill-switch toggle of a production AI agent (`services/api-gateway/src/composition/*-wiring.ts`).

## 5. Architecture Snapshot

For full architecture diagrams, see `Docs/ARCHITECTURE.md`, `Docs/ARCHITECTURE_BRAIN.md`, `Docs/ARCHITECTURE_CENTRAL_COMMAND.md`.

- **Frontend apps:** Next.js 14 App Router on Vercel — `apps/customer-app/`, `apps/estate-manager-app/`, `apps/owner-portal/`, `apps/internal-ops/`
- **Backend:** modular monolith of TypeScript services behind a single api-gateway (see `Docs/MODULAR_MONOLITH.md`)
- **Database:** Supabase (Postgres 16 + pgvector + RLS) — `fra1` primary, automated daily backups, PITR 7 days
- **AI orchestration:** multi-provider routing (Claude, OpenAI) via `packages/ai-copilot/src/orchestrator/`
- **Voice:** ElevenLabs TTS/STT + Africa's Talking
- **Cache & rate-limit:** Upstash Redis (multi-region)
- **Observability:** Application logs to Supabase + Vercel; security events to OCSF-formatted audit log; Sentry for errors

## 6. Defining Documents

| Document | Owner | Update cadence |
|---|---|---|
| This document | CRO + CCO | Annual |
| BoT cybersecurity mapping (doc 02) | CISO | Annual + on regulation change |
| PDPA mapping (doc 03) | DPO | Annual + on processing change |
| AML / KYC controls (doc 04) | MLRO | Annual + on FIU directive |
| Model risk (doc 05) | Model Risk Manager | Quarterly review of inventory |
| Fairness & non-discrimination (doc 06) | CRO + CCO | Quarterly |
| IR / BCM / DR (docs 07, 08) | CISO | Annual + post-incident |
| Vendors (doc 09) | DPO + CISO | Quarterly |
| Audit trail (doc 10) | CCO | Annual |

## 7. Out of Scope

Borjie **does not**:

- Hold customer or tenant deposits, settle payments, or operate any e-money licence
- Lend money on its own balance sheet (no rent-advance, deposit-financing, or working-capital products)
- Provide investment, insurance or securities advice
- Operate any service requiring a banking, microfinance, money-services or insurance licence
- Process biometric or facial-recognition data for any purpose other than tenant KYC liveness initiated by the tenant
- Sell, share or syndicate tenant personal data for marketing purposes

Any expansion beyond this scope requires a board-approved change of business plan and supplementary regulatory engagement.

> TODO: insert link to most recent board minutes confirming scope (post-board-meeting 2026-Q3).

---

## Appendix A — Board Sign-Off

| Role | Name | Date | Signature URL |
|---|---|---|---|
| Chief Risk Officer (CRO) | _TODO — appoint_ | _yyyy-mm-dd_ | `https://docs.borjie.com/signoffs/cro/regulator-pack-tz-01-v1.0` |
| Chief Compliance Officer (CCO) | _TODO — appoint_ | _yyyy-mm-dd_ | `https://docs.borjie.com/signoffs/cco/regulator-pack-tz-01-v1.0` |
| Chief Information Security Officer (CISO) | _TODO — appoint_ | _yyyy-mm-dd_ | `https://docs.borjie.com/signoffs/ciso/regulator-pack-tz-01-v1.0` |
| Data Protection Officer (DPO) | _TODO — appoint_ | _yyyy-mm-dd_ | `https://docs.borjie.com/signoffs/dpo/regulator-pack-tz-01-v1.0` |
| Board Chair | _TODO — appoint_ | _yyyy-mm-dd_ | `https://docs.borjie.com/signoffs/board/regulator-pack-tz-01-v1.0` |

## Appendix B — Version History

| Version | Date | Change | Approver |
|---|---|---|---|
| 1.0.0 | 2026-05-22 | Initial scaffold (F3 wave) | CRO + CCO |
| 1.1.0 | 2026-05-22 | Embedded real source-paths (Wave-12 push to substantive) | CRO + CCO |

## Appendix C — Review Cadence

- **Annual** — full review by CRO + CCO + Board sign-off
- **Out-of-cycle** — triggered by (a) material change to any referenced source file in the §1.1 table, (b) regulator change (BoT supervisory letter, PDPC directive), (c) post-P0/P1 incident affecting in-scope capability
- **Quarterly** — Risk & Audit Committee review of the risk taxonomy in §3 against incident telemetry
